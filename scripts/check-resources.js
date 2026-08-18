#!/usr/bin/env node
/**
 * scripts/check-resources.js — 自动化资源巡检与优化建议
 * 环境变量: VERCEL_TOKEN / VERCEL_TEAM_ID / NEON_API_KEY / NEON_PROJECT_ID / DATABASE_URL
 * 阈值: Vercel 用量 >= 免费额度 70% → 警告；Neon 存储 >= 300MB → 警告
 * 输出: stdout 报告 + check-resources-report.json（始终）+ check-resources-report.md（仅警告）
 * 退出码: 0=正常 2=命中警告 1=采集/环境错误
 */
const fs = require("fs");
const path = require("path");

const VERCEL_TOKEN = process.env.VERCEL_TOKEN ?? "";
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID ?? "";
const NEON_API_KEY = process.env.NEON_API_KEY ?? "";
const NEON_PROJECT_ID = process.env.NEON_PROJECT_ID ?? "";
const DATABASE_URL = process.env.DATABASE_URL ?? "";

const VERCEL_WARN_RATIO = Number(process.env.RESOURCE_WARN_VERCEL_RATIO ?? 0.7); // 免费额度 70%
const NEON_STORAGE_WARN_BYTES = Number(process.env.RESOURCE_WARN_NEON_MB ?? 300) * 1024 * 1024; // 300 MB
const VERCEL_FREE_LIMITS = {
  bandwidth: 100 * 1024 * 1024 * 1024,       // 100 GB/月
  functionExecution: 100 * 1024 * 1024 * 1024, // 100 GB-hrs/月
  edgeRequests: 1000000,
  builds: 100,
};

const now = new Date();
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
const MS_PER_DAY = 24 * 3600 * 1000;

function fmtBytes(n) {
  if (!Number.isFinite(n)) return "n/a";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 2)} ${u[i]}`;
}
function pct(used, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return (used / limit) * 100;
}
async function getJSON(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || json?.error?.code || text.slice(0, 160);
    throw new Error(`HTTP ${res.status} ${url.split("?")[0]} :: ${msg}`);
  }
  return json;
}
/** Vercel usage 指标可能是 {total,free} 对象或按日数组 */
function extractMetric(data, key) {
  const node = data?.usage?.[key];
  if (node === undefined || node === null) return null;
  if (Array.isArray(node)) {
    return {
      total: node.reduce((s, x) => s + Number(x?.total ?? 0), 0),
      free: node.reduce((s, x) => s + Number(x?.free ?? 0), 0),
    };
  }
  if (typeof node === "object") {
    return {
      total: Number(node.total ?? node.used ?? 0),
      free: Number(node.free ?? node.limit ?? 0),
    };
  }
  return { total: Number(node ?? 0), free: 0 };
}
function deriveNeonProjectId(connectionString) {
  try {
    const url = connectionString.replace(/^postgres(ql)?:\/\//, "https://");
    const seg = new URL(url).hostname.split(".")[0]; // ep-xxx-pooler
    let id = seg.replace(/^ep-/, "");
    if (id.endsWith("-pooler")) id = id.slice(0, -"-pooler".length);
    return /^[a-z0-9-]{1,60}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

async function fetchVercelUsage() {
  const from = Math.floor(monthStart.getTime() / 1000);
  const to = Math.floor(now.getTime() / 1000);
  const params = new URLSearchParams({ from: String(from), to: String(to) });
  if (VERCEL_TEAM_ID) params.set("teamId", VERCEL_TEAM_ID);
  const data = await getJSON(`https://api.vercel.com/v1/usage?${params}`, {
    Authorization: `Bearer ${VERCEL_TOKEN}`,
  });
  const used = {
    bandwidth: extractMetric(data, "bandwidth"),
    functionExecution: extractMetric(data, "functionExecution"),
    edgeRequests: extractMetric(data, "edgeRequests"),
    builds: extractMetric(data, "builds"),
  };
  for (const [k, m] of Object.entries(used)) {
    if (m && (!m.free || m.free <= 0) && VERCEL_FREE_LIMITS[k]) m.free = VERCEL_FREE_LIMITS[k];
  }
  return { plan: data?.plan ?? "unknown", period: data?.period ?? null, used };
}
async function fetchNeonStorageSql() {
  const { Pool } = require("@neondatabase/serverless");
  const pool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 8000 });
  try {
    const { rows } = await pool.query(
      `SELECT pg_database_size(current_database())::bigint AS bytes,
              pg_size_pretty(pg_database_size(current_database())) AS pretty`,
    );
    return { bytes: Number(rows[0]?.bytes ?? 0), pretty: rows[0]?.pretty ?? "", source: "sql" };
  } finally {
    await pool.end().catch(() => {});
  }
}
async function fetchNeonStorageApi(projectId) {
  const data = await getJSON(
    `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}`,
    { Authorization: `Bearer ${NEON_API_KEY}`, Accept: "application/json" },
  );
  const p = data?.project ?? {};
  const bytes = Number(p.data_storage_bytes_hour ?? 0);
  return {
    bytes,
    pretty: fmtBytes(bytes),
    dataTransferBytes: Number(p.data_transfer_bytes ?? 0),
    computeTimeSeconds: Number(p.compute_time_seconds ?? 0),
    source: "neon-api",
  };
}
async function fetchNeonStorage() {
  if (NEON_API_KEY) {
    const projectId = NEON_PROJECT_ID || deriveNeonProjectId(DATABASE_URL);
    if (projectId) {
      try {
        return await fetchNeonStorageApi(projectId);
      } catch (e) {
        if (DATABASE_URL) {
          console.log(`  [warn] Neon API 采集失败（${e.message}），改用 SQL 兜底`);
          return fetchNeonStorageSql();
        }
        throw e;
      }
    }
  }
  if (DATABASE_URL) return fetchNeonStorageSql();
  throw new Error("缺少 NEON_API_KEY 且缺少 DATABASE_URL，无法采集 Neon 存储用量");
}
function estimateExhaust(used, limit, elapsedRatio) {
  if (!Number.isFinite(used) || used <= 0 || !Number.isFinite(limit) || limit <= 0 || elapsedRatio <= 0) return null;
  const projected = used / elapsedRatio;
  if (projected >= limit) {
    const daysLeft = Math.max(0, Math.round((limit / used - 1) * (now - monthStart) / MS_PER_DAY));
    const eta = new Date(Date.now() + daysLeft * MS_PER_DAY).toISOString().slice(0, 10);
    return { projected, eta, daysLeft };
  }
  return { projected, eta: null, daysLeft: null };
}

async function main() {
  const elapsedRatio = (now - monthStart) / (new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() * MS_PER_DAY);
  const warnings = [];
  const report = {
    generatedAt: now.toISOString(),
    thresholds: { vercelWarnRatio: VERCEL_WARN_RATIO, neonStorageWarnMB: Math.round(NEON_STORAGE_WARN_BYTES / 1024 / 1024) },
    vercel: { configured: false, error: null, metrics: {} },
    neon: { configured: false, error: null, storage: null },
    warnings: [],
  };

  if (!VERCEL_TOKEN) {
    report.vercel.error = "VERCEL_TOKEN not configured（Vercel 后台 → Settings → Tokens 创建）";
    warnings.push({ scope: "config", message: report.vercel.error });
  } else {
    try {
      const v = await fetchVercelUsage();
      report.vercel.configured = true;
      report.vercel.plan = v.plan;
      report.vercel.period = v.period;
      for (const [key, m] of Object.entries(v.used)) {
        if (!m) continue;
        const ratio = pct(m.total, m.free);
        report.vercel.metrics[key] = { used: m.total, free: m.free, ratio: ratio == null ? null : Math.round(ratio * 100) / 100 };
        console.log(`  Vercel ${key}: 已用 ${fmtBytes(m.total)} / 免费 ${fmtBytes(m.free)} (${ratio == null ? "n/a" : ratio.toFixed(2)}%)`);
        if (ratio != null && ratio >= VERCEL_WARN_RATIO * 100) {
          const ex = estimateExhaust(m.total, m.free, elapsedRatio);
          warnings.push({
            scope: "vercel",
            metric: key,
            used: m.total,
            limit: m.free,
            ratio,
            eta: ex?.eta ?? null,
            message: `Vercel ${key} 已用 ${fmtBytes(m.total)} / 免费额度 ${fmtBytes(m.free)}（${ratio.toFixed(2)}%，超过 70% 阈值）${ex?.eta ? `，预计 ${ex.eta} 耗尽` : ""}`,
          });
        }
      }
    } catch (e) {
      report.vercel.error = e.message;
      warnings.push({ scope: "vercel", message: `Vercel 用量采集失败：${e.message}` });
    }
  }

  if (!NEON_API_KEY && !DATABASE_URL) {
    report.neon.error = "NEON_API_KEY 或 DATABASE_URL 均未配置，无法采集存储用量";
    warnings.push({ scope: "config", message: report.neon.error });
  } else {
    try {
      const n = await fetchNeonStorage();
      report.neon.configured = true;
      report.neon.storage = { bytes: n.bytes, pretty: n.pretty, source: n.source };
      if (n.dataTransferBytes != null) report.neon.storage.dataTransferBytes = n.dataTransferBytes;
      console.log(`  Neon 存储占用: ${n.pretty} (${fmtBytes(n.bytes)}) [source=${n.source}]`);
      if (n.bytes >= NEON_STORAGE_WARN_BYTES) {
        warnings.push({ scope: "neon", metric: "storage", used: n.bytes, limit: NEON_STORAGE_WARN_BYTES, message: `Neon 存储占用 ${n.pretty}，已达 ${Math.round(NEON_STORAGE_WARN_BYTES / 1024 / 1024)}MB 阈值，请清理历史数据或评估升级` });
      }
    } catch (e) {
      report.neon.error = e.message;
      warnings.push({ scope: "neon", message: `Neon 存储采集失败：${e.message}` });
    }
  }
  report.warnings = warnings;
  // 仅“真实资源阈值”触发预警 Issue（Vercel>=70% / Neon>=300MB）；配置缺失只记录，不刷屏
  const resourceWarnings = warnings.filter((w) => w.scope === "vercel" || w.scope === "neon");
  const configIssues = warnings.filter((w) => w.scope === "config");

  console.log(`\n# 🩺 资源巡检报告 (${now.toISOString()})`);
  console.log(`Vercel 阈值: 免费额度 ${VERCEL_WARN_RATIO * 100}% | Neon 阈值: 300MB`);
  console.log(`Vercel: ${report.vercel.configured ? "已连接" : "未配置(" + (report.vercel.error ?? "?") + ")"}`);
  console.log(`Neon  : ${report.neon.configured ? "已连接" : "未配置(" + (report.neon.error ?? "?") + ")"}`);
  if (warnings.length === 0) {
    console.log("\n✅ 当前用量正常，未触发任何阈值。");
  } else {
    console.log(`\n⚠️ 命中 ${warnings.length} 项提示：`);
    for (const w of warnings) console.log(`  - ${w.message}`);
  }

  fs.writeFileSync(path.join(__dirname, "..", "check-resources-report.json"), JSON.stringify(report, null, 2), "utf8");

  if (resourceWarnings.length > 0) {
    const md = [`# ⚠️ 资源瓶颈预警`, ``, `> 由 GitHub Actions 自动巡检生成于 ${now.toISOString()}`, ``, `## 当前用量`, ``];
    if (report.vercel.configured) {
      md.push(`**Vercel**（计划 ${report.vercel.plan ?? "unknown"}）：`);
      for (const [k, m] of Object.entries(report.vercel.metrics)) {
        md.push(`- ${k}: 已用 \`${fmtBytes(m.used)}\` / 免费 \`${fmtBytes(m.free)}\`（${m.ratio == null ? "n/a" : m.ratio.toFixed(2) + "%"}）`);
      }
      md.push(``);
    } else {
      md.push(`**Vercel**：未配置（${report.vercel.error ?? "?"}）\n`);
    }
    if (report.neon.storage) md.push(`**Neon 存储**：\`${report.neon.storage.pretty}\`\n`);
    else md.push(`**Neon**：未配置（${report.neon.error ?? "?"}）\n`);
    md.push(`## 预警明细`, ``);
    for (const w of resourceWarnings) md.push(`- ${w.message}`);
    if (configIssues.length > 0) {
      md.push(``, `## 配置提醒`, ``);
      for (const w of configIssues) md.push(`- ${w.message}`);
    }
    md.push(``, `## 建议`, ``,
      `1. 若接近免费额度上限：优先优化（开启 ISR 缓存 / 清理历史数据 / 压缩图片静态资源），再考虑升级。`,
      `2. Vercel Pro：$20/月，带宽 1TB、函数执行 1000GB-hrs、无每日构建限制。`,
      `3. Neon Pro：$19/月起，存储 10GB、可关闭 scale-to-zero 避免冷启动。`, ``);
    fs.writeFileSync(path.join(__dirname, "..", "check-resources-report.md"), md.join("\n"), "utf8");
  }

  const hasWarning = resourceWarnings.length > 0;
  console.log(`\n退出码: ${hasWarning ? 2 : 0}`);
  process.exit(hasWarning ? 2 : 0);
}

main().catch((e) => {
  console.error("[check-resources] FATAL:", e.message);
  process.exit(1);
});
