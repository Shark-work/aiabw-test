/**
 * Phase 13 · 生产冒烟脚本（2026-09-30）：对正式域名执行完整用户流程验收，42 项检查。
 * 流程：8 页面 → 注册/登录 → 鉴权负例 → 公开目录/看板 → SQL 充值 → 买包/开包 →
 * 详情页/焦点 → 背包/道具/互动 → 再买包 → 融合 → 销毁 → 负例 → 详情/用户中心 →
 * Stripe 降级 → webhook → 国内支付占位。
 * 用法（PowerShell，仓库根目录）：
 *   $env:DATABASE_URL="postgresql://…生产-pooler…"   # 必需：SQL 充值直写目标库
 *   $env:SMOKE_BASE="https://www.aiabw.com"           # 默认即此值
 *   node scripts/smoke-production.mjs
 * 全绿输出 ALL_SMOKE_OK，退出码 0；任一失败输出 HTTP 状态码 + 响应体前 200 字符，退出码 1。
 * ⚠️ 会在目标库留下测试痕迹：1 个 smoke 用户 + 充值/消费/铸造/融合/销毁流水（append-only），
 *    测试用户邮箱形如 prod-smoke-<ts>@test.dev，可事后清理。
 * 与用户原始清单的两处对齐修正（以代码事实为准）：
 *  - 注册/登录实际路由 = /api/auth/register、/api/auth/login（/api/user/* 无此端点）；
 *  - /api/stripe/create-checkout 仅导出 POST（GET 会 405）→ 用「POST + 登录态」验证
 *    未配密钥时 503 PAYMENT_NOT_CONFIGURED（配置密钥后断言自动切换为校验真实 Checkout URL）。
 */
import fs from "node:fs";
import path from "node:path";
import { Pool } from "@neondatabase/serverless";

const BASE = (process.env.SMOKE_BASE ?? "https://www.aiabw.com").replace(/\/+$/, "");

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  for (const name of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "").trim();
    }
  }
  throw new Error("DATABASE_URL not found（生产冒烟需要：SQL 充值直写目标库）");
}

const DB_URL = resolveDatabaseUrl();
const dbHost = DB_URL.match(/@([^/]+)\//)?.[1] ?? "unknown";
console.log(`SMOKE_BASE = ${BASE}`);
console.log(`DATABASE   = ${dbHost}（SQL 充值将直写此库，确认与 BASE 环境一致！）\n`);

let stepNo = 0;
let failures = 0;
function check(name, ok, { status, raw, extra } = {}) {
  stepNo += 1;
  if (ok) {
    console.log(`step ${stepNo}: OK  ${name}${extra ? ` — ${extra}` : ""}`);
  } else {
    failures += 1;
    const preview = typeof raw === "string" ? raw.slice(0, 200).replace(/\s+/g, " ") : "";
    console.log(`step ${stepNo}: FAIL ${name} — HTTP ${status ?? "-"} body=${preview}`);
  }
}

async function api(pathname, { method = "GET", token, body } = {}) {
  const headers = { "x-locale": "zh" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let json = {};
  try { json = JSON.parse(raw); } catch { /* 页面/非 JSON 响应 */ }
  return { status: res.status, json, raw };
}

const pool = new Pool({ connectionString: DB_URL });
const ts = Date.now();
const email = `prod-smoke-${ts}@test.dev`;
const password = "smoke-pass-123";

try {
  // ── 1-8) 公开页面可达（/zh 前缀；首页须含 AIABW 品牌文本）────────────────
  const home = await api("/zh/");
  check("首页 /zh HTTP 200 + 含 \"AIABW\"", home.status === 200 && home.raw.includes("AIABW"), home);
  for (const [label, url] of [
    ["/zh/codex 图鉴", "/zh/codex"],
    ["/zh/bag 背包", "/zh/bag"],
    ["/zh/packs 卡包", "/zh/packs"],
    ["/zh/shop 道具商店", "/zh/shop"],
    ["/zh/profile 用户中心", "/zh/profile"],
    ["/zh/supply 总量看板", "/zh/supply"],
    ["/zh/soul-cards 灵魂卡", "/zh/soul-cards"],
  ]) {
    const res = await api(url);
    check(`页面 ${label} 可访问`, res.status === 200, res);
  }

  // ── 9-10) 注册 + 登录（实际路由 /api/auth/*）────────────────────────────
  const reg = await api("/api/auth/register", {
    method: "POST",
    body: { email, password, username: `smk${ts.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}` },
  });
  const token = reg.json?.token ?? reg.json?.data?.token ?? null;
  const userId = reg.json?.user?.id ?? reg.json?.data?.user?.id ?? null;
  check("POST /api/auth/register 注册新用户（token + userId）",
    reg.status < 400 && !!token && !!userId, reg);
  const login = await api("/api/auth/login", { method: "POST", body: { identifier: email, password } });
  const loginToken = login.json?.token ?? login.json?.data?.token ?? null;
  check("POST /api/auth/login 登录获取 token",
    login.status < 400 && typeof loginToken === "string" && loginToken.length > 20, login);

  // ── 11) 鉴权负例 ────────────────────────────────────────────────────────
  const noAuth = await api("/api/pack/buy", { method: "POST", body: { packId: "starter" } });
  check("未登录 /api/pack/buy → 401 UNAUTHORIZED",
    noAuth.status === 401 && noAuth.json.code === "UNAUTHORIZED", noAuth);

  // ── 12-17) 公开目录/看板/持有（新用户为空）───────────────────────────────
  const packs = await api("/api/pack/list");
  check("GET /api/pack/list = 4 卡包", packs.status === 200 && packs.json.data?.packs?.length === 4, packs);
  const items = await api("/api/item/list");
  check("GET /api/item/list = 5 道具", items.status === 200 && items.json.data?.items?.length === 5, items);
  const bagEmpty = await api("/api/bag/items", { token });
  check("GET /api/bag/items 新用户空背包",
    bagEmpty.status === 200 && Array.isArray(bagEmpty.json.data?.items) && bagEmpty.json.data.items.length === 0, bagEmpty);
  const ownerEmpty = await api(`/api/aibi/owner/${userId}`);
  check("GET /api/aibi/owner/:userId 新用户持有 0",
    ownerEmpty.status === 200 && ownerEmpty.json.data?.count === 0 && ownerEmpty.json.data?.tokens?.length === 0, ownerEmpty);
  const supply0 = await api("/api/aibi/supply");
  check("GET /api/aibi/supply 供应看板可读",
    supply0.status === 200 && typeof supply0.json.data?.totalMinted === "number",
    { ...supply0, extra: `minted=${supply0.json.data?.totalMinted}` });
  const catalog = await api("/api/aibi/list");
  check("GET /api/aibi/list = 12 物种", catalog.status === 200 && catalog.json.data?.count === 12, catalog);

  // ── 18-20) SQL 充值 → 买 summon → 开包（余额口径与 dev 冒烟一致）─────────────
  await pool.query(`UPDATE users SET points = points + 20000 WHERE id = $1::uuid`, [userId]);
  check("SQL 充值 20000 积分（冒烟专用，直写目标库）", true);
  // 余额：20（注册欢迎礼）+ 20000 − 10000（summon）= 10020
  const buy = await api("/api/pack/buy", { method: "POST", token, body: { packId: "summon", quantity: 1 } });
  check("POST /api/pack/buy(summon) 扣款正确",
    buy.status === 200 && buy.json.data?.balance === 10020,
    { ...buy, extra: `balance=${buy.json.data?.balance}` });
  const open = await api("/api/pack/open", { method: "POST", token, body: { packId: "summon" } });
  const opened = open.json.data;
  const tokenId = opened?.token?.aibiTokenId;
  check("POST /api/pack/open(summon) → legendary/mythic + 链上凭证",
    open.status === 200 && ["legendary", "mythic"].includes(opened?.rarity) && !!tokenId,
    { ...open, extra: `rarity=${opened?.rarity} token=${tokenId}` });

  // ── 21-23) 公开详情页 / 首页焦点（铸造后 latest 必有内容）/ 背包含新艾比 ──────
  const detailPage = await api(`/zh/aibi/${tokenId}`);
  check("/zh/aibi/[tokenId] 公开详情页 200", detailPage.status === 200, detailPage);
  const spot = await api("/api/aibi/spotlight");
  check("GET /api/aibi/spotlight 最新铸造 + 稀有橱窗",
    spot.status === 200 && Array.isArray(spot.json.data?.latest) && spot.json.data.latest.length >= 1 &&
    spot.json.data.latest.every((r) => !!r.species) && spot.json.data?.rareShowcase?.length >= 1,
    { ...spot, extra: `latest=${spot.json.data?.latest?.length} rare=${spot.json.data?.rareShowcase?.length}` });
  const bagA = await api("/api/bag/aibis", { token });
  check("GET /api/bag/aibis 含新铸造艾比",
    bagA.status === 200 && bagA.json.data?.tokens?.some((t) => t.aibiTokenId === tokenId), bagA);

  // ── 24-27) 道具：买 ×2 → 入包 → 使用 → 互动 ─────────────────────────────
  const buyItem = await api("/api/item/buy", { method: "POST", token, body: { itemId: "energy_fruit", quantity: 2 } });
  // 余额：10020 − 50×2 = 9920
  check("POST /api/item/buy(energy_fruit ×2)",
    buyItem.status === 200 && buyItem.json.data?.quantity === 2 && buyItem.json.data?.balance === 9920,
    { ...buyItem, extra: `balance=${buyItem.json.data?.balance}` });
  const bagI = await api("/api/bag/items", { token });
  check("GET /api/bag/items energy_fruit ×2 入包",
    bagI.status === 200 && bagI.json.data?.items?.some((i) => i.itemId === "energy_fruit" && i.quantity >= 2), bagI);
  const use = await api("/api/bag/use", { method: "POST", token, body: { itemId: "energy_fruit", tokenId } });
  check("POST /api/bag/use → energy 结算",
    use.status === 200 && typeof use.json.data?.state?.energy === "number",
    { ...use, extra: `energy=${use.json.data?.state?.energy}` });
  const inter = await api("/api/interact", { method: "POST", token, body: { tokenId, action: "play" } });
  check("POST /api/interact(play)",
    inter.status === 200 && inter.json.data?.action === "play",
    { ...inter, extra: `mood=${inter.json.data?.state?.mood}` });

  // ── 28-30) 再买 starter → 开包拿素材 2（融合前置）─────────────────────────
  const buy2 = await api("/api/pack/buy", { method: "POST", token, body: { packId: "starter", quantity: 1 } });
  // 余额：9920 − 100 = 9820
  check("POST /api/pack/buy(starter)",
    buy2.status === 200 && buy2.json.data?.balance === 9820,
    { ...buy2, extra: `balance=${buy2.json.data?.balance}` });
  const open2 = await api("/api/pack/open", { method: "POST", token, body: { packId: "starter" } });
  const token2 = open2.json.data?.token?.aibiTokenId;
  check("POST /api/pack/open(starter) → 素材 2",
    open2.status === 200 && !!token2,
    { ...open2, extra: `rarity=${open2.json.data?.rarity} token=${token2}` });

  // ── 31-34) 融合（素材销毁 + 新艾比入库）→ 销毁（列表实时移除）───────────────
  const fuse = await api("/api/aibi/fuse", { method: "POST", token, body: { tokenIds: [tokenId, token2] } });
  const fused = fuse.json.data;
  check("POST /api/aibi/fuse → 结果稀有度=素材最高档",
    fuse.status === 200 && fused?.consumed?.length === 2 &&
    ["legendary", "mythic"].includes(fused?.minted?.species?.rarityId),
    { ...fuse, extra: `rarity=${fused?.minted?.species?.rarityId} token=${fused?.minted?.aibiTokenId}` });
  const bagAfterFuse = await api("/api/bag/aibis", { token });
  check("融合后背包：素材消失 + 新艾比入库",
    bagAfterFuse.status === 200 &&
    !bagAfterFuse.json.data?.tokens?.some((t) => t.aibiTokenId === tokenId || t.aibiTokenId === token2) &&
    bagAfterFuse.json.data?.tokens?.some((t) => t.aibiTokenId === fused?.minted?.aibiTokenId), bagAfterFuse);
  const burn = await api("/api/aibi/burn", { method: "POST", token, body: { tokenId: fused?.minted?.aibiTokenId } });
  check("POST /api/aibi/burn", burn.status === 200 && typeof burn.json.data?.supplyAfter === "number",
    { ...burn, extra: `supplyAfter=${burn.json.data?.supplyAfter}` });
  const bagAfterBurn = await api("/api/bag/aibis", { token });
  check("销毁后背包实时移除",
    bagAfterBurn.status === 200 &&
    !bagAfterBurn.json.data?.tokens?.some((t) => t.aibiTokenId === fused?.minted?.aibiTokenId), bagAfterBurn);

  // ── 35-37) 负例三连 ─────────────────────────────────────────────────────
  const fuseDup = await api("/api/aibi/fuse", { method: "POST", token, body: { tokenIds: [tokenId, tokenId] } });
  check("重复素材融合 → 400 FUSION_INVALID", fuseDup.status === 400 && fuseDup.json.code === "FUSION_INVALID", fuseDup);
  const burn404 = await api("/api/aibi/burn", { method: "POST", token, body: { tokenId: "AIBI-999999" } });
  check("销毁不存在 → 404 TOKEN_NOT_FOUND", burn404.status === 404 && burn404.json.code === "TOKEN_NOT_FOUND", burn404);
  const openAgain = await api("/api/pack/open", { method: "POST", token, body: { packId: "summon" } });
  check("无库存开包 → 400 INSUFFICIENT_ITEM", openAgain.status === 400 && openAgain.json.code === "INSUFFICIENT_ITEM", openAgain);

  // ── 38-39) 公开详情（ownerId 剥离 + 互动时间线）/ 持有者视角 ───────────────
  const pub = await api(`/api/aibi/token/${tokenId}`);
  check("GET /api/aibi/token/:id 公开可读（ownerId 剥离 + 时间线）",
    pub.status === 200 && pub.json.data?.aibiTokenId === tokenId &&
    pub.json.data?.viewerIsOwner === false && !("ownerId" in (pub.json.data ?? {})) &&
    pub.json.data?.interactions?.length >= 1, pub);
  const own = await api(`/api/aibi/token/${tokenId}`, { token });
  check("GET /api/aibi/token/:id 持有者 viewerIsOwner=true",
    own.status === 200 && own.json.data?.viewerIsOwner === true, own);

  // ── 40) 用户中心计数（全部融合/销毁后持有 0；铸造 3 / 销毁 3 / 道具 1 种）─────
  const prof = await api("/api/aibi/profile?page=1&pageSize=10", { token });
  check("GET /api/aibi/profile 计数与分页历史",
    prof.status === 200 && prof.json.data?.aibiCount === 0 && prof.json.data?.itemCount === 1 &&
    prof.json.data?.mints?.total === 3 && prof.json.data?.burns?.total === 3 && prof.json.data?.mints?.page === 1,
    { ...prof, extra: `mints=${prof.json.data?.mints?.total} burns=${prof.json.data?.burns?.total}` });

  // ── 41-42) 支付：Stripe 降级 + webhook 非 2xx + 国内占位 501 ───────────────
  const sc = await api("/api/stripe/create-checkout", { method: "POST", token, body: { type: "points", quantity: 1 } });
  check("create-checkout：无密钥 → 503 PAYMENT_NOT_CONFIGURED；有密钥 → Checkout URL",
    (sc.status === 503 && sc.json.code === "PAYMENT_NOT_CONFIGURED") ||
    (sc.status === 200 && typeof sc.json.data?.url === "string" && sc.json.data.url.startsWith("https://checkout.stripe.com/")),
    { ...sc, extra: `HTTP ${sc.status} code=${sc.json.code ?? "-"}` });
  const wh = await api("/api/stripe/webhook", { method: "POST", body: { fake: true } });
  check("webhook 未配置/缺签名 → 500 或 400 带 code（Stripe 重试策略重发）",
    (wh.status === 500 || wh.status === 400) && typeof wh.json.code === "string",
    { ...wh, extra: `HTTP ${wh.status} code=${wh.json.code}` });
  const dom = await api("/api/payment/domestic");
  check("GET /api/payment/domestic → 501 DOMESTIC_PAYMENT_PENDING",
    dom.status === 501 && dom.json.code === "DOMESTIC_PAYMENT_PENDING" &&
    Array.isArray(dom.json.details?.plannedProviders) && dom.json.details.plannedProviders.includes("alipay"), dom);
} catch (err) {
  failures += 1;
  console.error(`\nsmoke crashed at step ${stepNo + 1}:`, err);
} finally {
  await pool.end().catch(() => {});
}

console.log(`\n=== production smoke: ${stepNo - failures}/${stepNo} passed ===`);
if (failures === 0 && stepNo === 42) {
  console.log("ALL_SMOKE_OK");
  process.exit(0);
}
process.exit(1);



