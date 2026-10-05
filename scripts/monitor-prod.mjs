#!/usr/bin/env node
/**
 * 阶段 5 · 生产 24h 监控脚本（每小时一次）
 * ============================================================
 * 检查项：
 *   1. DB `_schema_meta.version = 18`（≠18 或 -1 死锁 → ALERT，见 ROLLBACK_GUIDE §三）
 *   2. DB 连接数 < 阈值（默认 80；env MONITOR_DB_CONN_WARN 覆盖）
 *   3. DB 磁盘 < 阈值（默认 300MB，对齐 check-resources.js；env MONITOR_DB_SIZE_WARN_MB 覆盖）
 *   4. HTTP 合成探测（黑盒 5xx 防线，不依赖 Vercel API 权限）：
 *        GET  /zh/                                   期望 200
 *        GET  /zh/soul-cards                         期望 200
 *        GET  /api/user/checkin                      期望 401（路由存活）
 *        POST /api/exploration/start（无 token）      期望 401
 *        GET  /api/postcard-wall/<零 uuid>            期望 404（路由存活）
 *      任一 5xx 或偏离期望 → ALERT
 *   5. Vercel Runtime Logs 最近 1h 5xx（VERCEL_TOKEN 存在时；
 *      projectId 取 env VERCEL_PROJECT_ID，缺省读 .vercel/project.json；
 *      端点不可用时 SKIP，由检查 4 黑盒兜底）
 *
 * 调度：
 *   - 云端（推荐）：.github/workflows/monitor-prod.yml，每小时 cron，
 *     失败自动开 Issue「🚨 生产监控告警」（已开不重复，防刷屏）；
 *   - Windows 本机备选（需本机常驻 + .env 含 DATABASE_URL）：
 *       schtasks /create /tn "aiabw-monitor-prod" /sc hourly /mo 1 ^
 *         /tr "node d:\p2\aiabw-test\scripts\monitor-prod.mjs"
 *
 * 输出：每检查 [OK]/[ALERT]/[SKIP] + 汇总 PROD_MONITOR_OK / PROD_MONITOR_ALERT；
 *   退出码 0=正常 1=告警（GHA 据此判红并开 Issue）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.MONITOR_BASE ?? process.env.SMOKE_BASE ?? "https://www.aiabw.com").replace(/\/+$/, "");
const DB_CONN_WARN = Number(process.env.MONITOR_DB_CONN_WARN ?? 80);
const DB_SIZE_WARN = Number(process.env.MONITOR_DB_SIZE_WARN_MB ?? 300) * 1024 * 1024;
const SCHEMA_EXPECT = Number(process.env.MONITOR_SCHEMA_EXPECT ?? 18);

/* ── env 解析：process.env 优先，回退 .env（与 verify-checkin.cjs 同模式）── */
function envOrFile(key) {
  if (process.env[key]) return process.env[key];
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    return (fs.readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.*)$`, "m")) || [])[1]?.trim() ?? "";
  }
  return "";
}
const DATABASE_URL = envOrFile("DATABASE_URL");
const VERCEL_TOKEN = envOrFile("VERCEL_TOKEN");
let VERCEL_PROJECT_ID = envOrFile("VERCEL_PROJECT_ID");
if (!VERCEL_PROJECT_ID) {
  try {
    VERCEL_PROJECT_ID = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".vercel", "project.json"), "utf8"))?.projectId ?? "";
  } catch { /* 无 .vercel/project.json */ }
}

/* ── 报告器 ── */
const lines = [];
let alerts = 0;
function report(level, name, detail = "") {
  if (level === "ALERT") alerts += 1;
  const tag = level === "OK" ? "[OK]" : level === "SKIP" ? "[SKIP]" : "[ALERT]";
  const line = `${tag} ${name}${detail ? ` — ${detail}` : ""}`;
  lines.push(line);
  console.log(line);
}

const ts = new Date().toISOString();
/* ── 1~3 DB 检查 ── */
if (!DATABASE_URL) {
  report("ALERT", "DATABASE_URL 缺失，DB 三项检查无法执行");
} else {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 10000 });
  try {
    const q = (sql, p) =>
      Promise.race([pool.query(sql, p), new Promise((_, rej) => setTimeout(() => rej(new Error("DB_TIMEOUT")), 20000))]);

    const meta = await q(`SELECT version FROM "_schema_meta" LIMIT 1`);
    const version = meta.rows[0]?.version ?? null;
    report(version === SCHEMA_EXPECT ? "OK" : "ALERT", `_schema_meta.version = ${SCHEMA_EXPECT}`,
      `actual=${version}${version === -1 ? "（-1 = 迁移死锁，立即按 ROLLBACK_GUIDE §三处置）" : ""}`);

    const conns = await q(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`);
    const n = conns.rows[0]?.n ?? -1;
    report(n >= 0 && n < DB_CONN_WARN ? "OK" : "ALERT", `DB 连接数 < ${DB_CONN_WARN}`, `actual=${n}`);

    const size = await q(`SELECT pg_database_size(current_database())::bigint AS bytes`);
    const bytes = Number(size.rows[0]?.bytes ?? -1);
    const mb = (bytes / 1024 / 1024).toFixed(1);
    report(bytes >= 0 && bytes < DB_SIZE_WARN ? "OK" : "ALERT", `DB 磁盘 < ${DB_SIZE_WARN / 1024 / 1024}MB`, `actual=${mb}MB`);
  } catch (e) {
    report("ALERT", "DB 检查异常", e?.message ?? String(e));
  } finally {
    try { await pool.end(); } catch { /* ignore */ }
  }
}

/* ── 4 HTTP 合成探测 ── */
const probes = [
  { name: "GET /zh/", path: "/zh/", method: "GET", expect: [200] },
  { name: "GET /zh/soul-cards", path: "/zh/soul-cards", method: "GET", expect: [200] },
  { name: "GET /api/user/checkin（匿名）", path: "/api/user/checkin", method: "GET", expect: [401] },
  { name: "POST /api/exploration/start（匿名）", path: "/api/exploration/start", method: "POST", expect: [401] },
  { name: "GET /api/postcard-wall/<零uuid>", path: "/api/postcard-wall/00000000-0000-0000-0000-000000000000", method: "GET", expect: [404] },
];
for (const p of probes) {
  try {
    const res = await fetch(`${BASE}${p.path}`, { method: p.method, signal: AbortSignal.timeout(20000) });
    await res.arrayBuffer(); // drain
    if (res.status >= 500) report("ALERT", `HTTP 探测 ${p.name}`, `5xx=${res.status}`);
    else if (!p.expect.includes(res.status)) report("ALERT", `HTTP 探测 ${p.name}`, `expect=${p.expect.join("|")} actual=${res.status}`);
    else report("OK", `HTTP 探测 ${p.name}`, `status=${res.status}`);
  } catch (e) {
    report("ALERT", `HTTP 探测 ${p.name}`, `fetch 失败：${e?.message ?? e}`);
  }
}

/* ── 5 Vercel Runtime Logs 最近 1h 5xx（可选，依赖 token；失败降级 SKIP，由检查 4 兜底）── */
if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) {
  report("SKIP", "Vercel Runtime Logs 5xx 检查", "缺 VERCEL_TOKEN 或 projectId（5xx 由 HTTP 合成探测兜底）");
} else {
  try {
    const since = Date.now() - 3600 * 1000;
    const url = `https://api.vercel.com/v1/logs?projectId=${VERCEL_PROJECT_ID}&since=${since}&limit=100`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);
    let entries = [];
    try { entries = JSON.parse(text); } catch { entries = []; }
    if (!Array.isArray(entries)) entries = [];
    const fives = entries.filter((e) => {
      const code = Number(e?.statusCode ?? e?.proxy?.statusCode ?? e?.response?.statusCode ?? 0);
      return code >= 500;
    });
    report(fives.length === 0 ? "OK" : "ALERT", "Vercel Runtime Logs 最近 1h 无 5xx",
      `entries=${entries.length} 5xx=${fives.length}`);
  } catch (e) {
    report("SKIP", "Vercel Runtime Logs 5xx 检查", `端点不可用（${(e?.message ?? e).slice(0, 80)}），由 HTTP 探测兜底`);
  }
}

/* ── 汇总 ── */
console.log("");
if (alerts === 0) {
  console.log(`PROD_MONITOR_OK（${lines.filter((l) => l.startsWith("[OK]")).length} 项通过，${lines.filter((l) => l.startsWith("[SKIP]")).length} 项跳过）`);
  process.exit(0);
}
console.error(`PROD_MONITOR_ALERT：${alerts} 项告警`);
for (const l of lines.filter((x) => x.startsWith("[ALERT]"))) console.error("  " + l);
process.exit(1);

console.log(`PROD_MONITOR ${ts}  BASE=${BASE}\n`);
