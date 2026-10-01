/**
 * Phase 5-8 冒烟脚本（2026-09-30）：模拟「注册 → 充值积分 → 浏览商店 → 购买卡包 →
 * 开包 → 查看背包 → 道具使用 → 互动 → 供应/目录/持有 → 道具目录 → 再买一包 →
 * 融合（素材销毁+新艾比） → 销毁（列表移除） → Phase 7/8 页面与新接口
 * （codex/supply/profile/aibi 详情页 + spotlight/token 详情/供应历史/用户中心）」全链路。
 * 用法：先启动服务（next start -p 3100），再 node scripts/smoke-aibi-frontend.mjs
 * 仅写 dev 库（.env.local DATABASE_URL）；铸造/积分日志为 append-only 测试痕迹。
 */
import fs from "node:fs";
import path from "node:path";
import { Pool } from "@neondatabase/serverless";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3100";

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
  throw new Error("DATABASE_URL not found");
}

const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
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
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const pool = new Pool({ connectionString: resolveDatabaseUrl() });
const email = `aibi-p5-smoke-${Date.now()}@test.dev`;
let failures = 0;

try {
  // 0) 服务可达
  const home = await fetch(`${BASE}/zh/packs`).catch(() => null);
  check("页面 /zh/packs 可达", !!home && home.status === 200, `HTTP ${home?.status}`);

  // 1) 注册
  const reg = await api("/api/auth/register", {
    method: "POST",
    body: { email, password: "smoke-pass-123", username: `smoke${Date.now() % 100000}` },
  });
  const token = reg.json?.token ?? reg.json?.data?.token ?? null;
  const userId = reg.json?.user?.id ?? reg.json?.data?.user?.id ?? null;
  check("注册并拿到令牌", reg.status < 400 && !!token && !!userId, `HTTP ${reg.status}`);

  // 2) SQL 充值 20000 积分（冒烟专用；需覆盖 summon 10000 + energy_fruit ×2(100) + starter 100）
  await pool.query(`UPDATE users SET points = points + 20000 WHERE id = $1::uuid`, [userId]);
  check("SQL 充值 20000 积分", true);

  // 3) 浏览商店（公开）
  const list = await api("/api/pack/list");
  check("GET /api/pack/list = 4 卡包", list.status === 200 && list.json.data?.packs?.length === 4);

  // 4) 购买 summon（10000 积分，保底传说/神话 → 触发 4/5 档动画路径）
  const buy = await api("/api/pack/buy", { method: "POST", token, body: { packId: "summon", quantity: 1 } });
  // 余额口径：20（注册欢迎礼）+ 20000（SQL 充值）- 10000（summon 价格）= 10020
  check("POST /api/pack/buy(summon)", buy.status === 200 && buy.json.data?.balance === 10020,
    `balance=${buy.json.data?.balance}`);

  // 5) 开包
  const open = await api("/api/pack/open", { method: "POST", token, body: { packId: "summon" } });
  const opened = open.json.data;
  check("POST /api/pack/open → legendary/mythic",
    open.status === 200 && ["legendary", "mythic"].includes(opened?.rarity),
    `rarity=${opened?.rarity} species=${opened?.species?.id} token=${opened?.token?.aibiTokenId}`);
  const tokenId = opened?.token?.aibiTokenId;

  // 6) 背包：艾比 + 道具
  const bagA = await api("/api/bag/aibis", { token });
  check("GET /api/bag/aibis 含新艾比",
    bagA.status === 200 && bagA.json.data?.tokens?.some((t) => t.aibiTokenId === tokenId));

  // 7) 买道具（数量选择 1~99，6.3.2）+ 使用
  const buyItem = await api("/api/item/buy", { method: "POST", token, body: { itemId: "energy_fruit", quantity: 2 } });
  // 余额口径：10020（step4 后）- 50×2（energy_fruit ×2）= 9920
  check("POST /api/item/buy(energy_fruit ×2)",
    buyItem.status === 200 && buyItem.json.data?.quantity === 2 && buyItem.json.data?.cost === 100 &&
    buyItem.json.data?.balance === 9920,
    `balance=${buyItem.json.data?.balance}`);
  const bagI = await api("/api/bag/items", { token });
  check("GET /api/bag/items energy_fruit ×2 入包",
    bagI.status === 200 && bagI.json.data?.items?.some((i) => i.itemId === "energy_fruit" && i.quantity >= 2));
  const use = await api("/api/bag/use", { method: "POST", token, body: { itemId: "energy_fruit", tokenId } });
  check("POST /api/bag/use → energy 结算",
    use.status === 200 && typeof use.json.data?.state?.energy === "number",
    `energy=${use.json.data?.state?.energy} mood=${use.json.data?.state?.mood}`);

  // 8) 互动 feed/train/talk/play
  const inter = await api("/api/interact", { method: "POST", token, body: { tokenId, action: "play" } });
  check("POST /api/interact(play)",
    inter.status === 200 && inter.json.data?.action === "play",
    `mood=${inter.json.data?.state?.mood} leveledUp=${inter.json.data?.leveledUp}`);

  // 9) 供应 / 目录 / 持有（soul-cards 三件套）
  const supply = await api("/api/aibi/supply");
  check("GET /api/aibi/supply", supply.status === 200 && supply.json.data?.totalMinted >= 1,
    `minted=${supply.json.data?.totalMinted}`);
  const catalog = await api("/api/aibi/list");
  check("GET /api/aibi/list = 12 物种", catalog.status === 200 && catalog.json.data?.count === 12);
  const owned = await api(`/api/aibi/owner/${userId}`);
  check("GET /api/aibi/owner/:uuid 含新艾比",
    owned.status === 200 && owned.json.data?.tokens?.some((t) => t.aibiTokenId === tokenId));

  // 10) Phase 6 · 道具商店目录（6.3）
  const itemList = await api("/api/item/list");
  check("GET /api/item/list = 5 道具",
    itemList.status === 200 && itemList.json.data?.items?.length === 5);

  // 11) Phase 6 · 融合前置：再买 starter（100 积分）拿第二只素材
  const buy2 = await api("/api/pack/buy", { method: "POST", token, body: { packId: "starter", quantity: 1 } });
  // 余额口径：10020（step4 后）- 100（step7 energy_fruit ×2）- 100（starter）= 9820
  check("POST /api/pack/buy(starter)", buy2.status === 200 && buy2.json.data?.balance === 9820,
    `balance=${buy2.json.data?.balance}`);
  const open2 = await api("/api/pack/open", { method: "POST", token, body: { packId: "starter" } });
  const token2 = open2.json.data?.token?.aibiTokenId;
  check("POST /api/pack/open(starter) → 素材 2", open2.status === 200 && !!token2,
    `rarity=${open2.json.data?.rarity} token=${token2}`);

  // 12) Phase 6 · 融合（6.1）：素材含 legendary/mythic → 结果稀有度 = 素材最高档
  const fuse = await api("/api/aibi/fuse", { method: "POST", token, body: { tokenIds: [tokenId, token2] } });
  const fused = fuse.json.data;
  check("POST /api/aibi/fuse → 结果稀有度=素材最高档",
    fuse.status === 200 && fused?.consumed?.length === 2 &&
    ["legendary", "mythic"].includes(fused?.minted?.species?.rarityId),
    `rarity=${fused?.minted?.species?.rarityId} species=${fused?.minted?.species?.id} token=${fused?.minted?.aibiTokenId}`);
  const bagAfterFuse = await api("/api/bag/aibis", { token });
  check("融合后背包：素材消失 + 新艾比入库",
    bagAfterFuse.status === 200 &&
    !bagAfterFuse.json.data?.tokens?.some((t) => t.aibiTokenId === tokenId || t.aibiTokenId === token2) &&
    bagAfterFuse.json.data?.tokens?.some((t) => t.aibiTokenId === fused?.minted?.aibiTokenId));

  // 13) Phase 6 · 销毁（6.2）：销毁融合产物 → 列表实时移除
  const burn = await api("/api/aibi/burn", { method: "POST", token, body: { tokenId: fused?.minted?.aibiTokenId } });
  check("POST /api/aibi/burn", burn.status === 200 && typeof burn.json.data?.supplyAfter === "number",
    `supplyAfter=${burn.json.data?.supplyAfter}`);
  const bagAfterBurn = await api("/api/bag/aibis", { token });
  check("销毁后背包实时移除",
    bagAfterBurn.status === 200 &&
    !bagAfterBurn.json.data?.tokens?.some((t) => t.aibiTokenId === fused?.minted?.aibiTokenId));

  // 14) Phase 6 负例：重复素材融合 → 400 FUSION_INVALID；销毁不存在 → 404 TOKEN_NOT_FOUND
  const fuseDup = await api("/api/aibi/fuse", { method: "POST", token, body: { tokenIds: [tokenId, tokenId] } });
  check("重复素材融合 → 400 FUSION_INVALID", fuseDup.status === 400 && fuseDup.json.code === "FUSION_INVALID");
  const burn404 = await api("/api/aibi/burn", { method: "POST", token, body: { tokenId: "AIBI-999999" } });
  check("销毁不存在 → 404 TOKEN_NOT_FOUND", burn404.status === 404 && burn404.json.code === "TOKEN_NOT_FOUND");

  // 15) 负例：未登录买包 → 401 UNAUTHORIZED；空背包开包 → 400 INSUFFICIENT_ITEM
  const noAuth = await api("/api/pack/buy", { method: "POST", body: { packId: "starter" } });
  check("未登录购买 → 401 UNAUTHORIZED", noAuth.status === 401 && noAuth.json.code === "UNAUTHORIZED");
  const openAgain = await api("/api/pack/open", { method: "POST", token, body: { packId: "summon" } });
  check("无库存开包 → 400 INSUFFICIENT_ITEM", openAgain.status === 400 && openAgain.json.code === "INSUFFICIENT_ITEM");

  // 16) Phase 7 · 新页面可达（8.1 首页区块 / 8.2 codex / 8.3 aibi 详情 / 8.7 profile / 8.8 supply）
  for (const [label, url] of [
    ["/zh/（首页含艾比区块）", "/zh/"],
    ["/zh/codex", "/zh/codex"],
    ["/zh/supply", "/zh/supply"],
    ["/zh/profile", "/zh/profile"],
    ["/zh/aibi/[tokenId]", `/zh/aibi/${tokenId}`],
  ]) {
    const res = await fetch(`${BASE}${url}`).catch(() => null);
    check(`页面 ${label} 可达`, !!res && res.status === 200, `HTTP ${res?.status}`);
  }

  // 17) Phase 7 · 首页焦点（公开）：最新铸造（流通中，冒烟 token 已被融合/销毁故不在列）+ 稀有榜非空
  const spot = await api("/api/aibi/spotlight");
  check("GET /api/aibi/spotlight 最新铸造 + 稀有榜",
    spot.status === 200 && spot.json.data?.latest?.length >= 1 &&
    spot.json.data.latest.every((r) => !!r.species) &&
    spot.json.data?.rareShowcase?.length >= 1,
    `latest=${spot.json.data?.latest?.length} rare=${spot.json.data?.rareShowcase?.length}`);

  // 18) Phase 7/9 · 公开详情：公开可读 + ownerId 不下发 + 互动时间线（interactions ≥1，step7/8 已互动）；Bearer → viewerIsOwner=true
  const pub = await api(`/api/aibi/token/${tokenId}`);
  check("GET /api/aibi/token/:id 公开可读（ownerId 剥离 + 互动时间线）",
    pub.status === 200 && pub.json.data?.aibiTokenId === tokenId &&
    pub.json.data?.viewerIsOwner === false && !("ownerId" in (pub.json.data ?? {})) &&
    pub.json.data?.provenance?.length === 2 &&
    Array.isArray(pub.json.data?.interactions) && pub.json.data.interactions.length >= 1,
    `status=${pub.json.data?.status} prov=${pub.json.data?.provenance?.length} acts=${pub.json.data?.interactions?.length}`);
  const own = await api(`/api/aibi/token/${tokenId}`, { token });
  check("GET /api/aibi/token/:id 持有者 viewerIsOwner=true",
    own.status === 200 && own.json.data?.viewerIsOwner === true);
  const token404 = await api("/api/aibi/token/AIBI-999999");
  check("详情不存在 → 404 TOKEN_NOT_FOUND", token404.status === 404 && token404.json.code === "TOKEN_NOT_FOUND");

  // 19) Phase 7 · 供应看板扩展（8.8）：history 分页 + snapshots 趋势
  const sup2 = await api("/api/aibi/supply?page=1&pageSize=5");
  check("GET /api/aibi/supply 分页历史 + 快照",
    sup2.status === 200 && sup2.json.data?.history?.rows?.length >= 1 &&
    sup2.json.data?.history?.pageSize === 5 && Array.isArray(sup2.json.data?.snapshots) &&
    sup2.json.data.latestSnapshot !== undefined,
    `historyTotal=${sup2.json.data?.history?.total}`);

  // 20) Phase 7 · 用户中心（8.7，鉴权）：全部艾比已融合/销毁 → 持有 0；铸造 3 / 销毁 3 / 道具 1
  const prof = await api("/api/aibi/profile?page=1&pageSize=10", { token });
  check("GET /api/aibi/profile 计数与分页历史",
    prof.status === 200 && prof.json.data?.aibiCount === 0 && prof.json.data?.itemCount === 1 &&
    prof.json.data?.mints?.total === 3 && prof.json.data?.burns?.total === 3 &&
    prof.json.data?.mints?.page === 1,
    `aibi=${prof.json.data?.aibiCount} items=${prof.json.data?.itemCount} mints=${prof.json.data?.mints?.total} burns=${prof.json.data?.burns?.total}`);
  const profNoAuth = await api("/api/aibi/profile");
  check("未登录 /api/aibi/profile → 401", profNoAuth.status === 401 && profNoAuth.json.code === "UNAUTHORIZED");

  // 21) Phase 11 · Stripe 支付：未配置环境走降级路径（配置密钥后走真实 Checkout，两种结果都合法）
  const scNoAuth = await api("/api/stripe/create-checkout", { method: "POST", body: { type: "points", quantity: 1 } });
  check("未登录 create-checkout → 401 UNAUTHORIZED",
    scNoAuth.status === 401 && scNoAuth.json.code === "UNAUTHORIZED");
  const scBad = await api("/api/stripe/create-checkout", { method: "POST", token, body: { type: "coupon" } });
  check("非法商品类型 → 400 VALIDATION_ERROR（参数校验先于通道降级）",
    scBad.status === 400 && scBad.json.code === "VALIDATION_ERROR");
  const sc = await api("/api/stripe/create-checkout", { method: "POST", token, body: { type: "points", quantity: 1 } });
  check("create-checkout：无密钥 → 503 PAYMENT_NOT_CONFIGURED；有密钥 → Checkout URL",
    (sc.status === 503 && sc.json.code === "PAYMENT_NOT_CONFIGURED") ||
    (sc.status === 200 && typeof sc.json.data?.url === "string" && sc.json.data.url.startsWith("https://checkout.stripe.com/")),
    `HTTP ${sc.status} code=${sc.json.code ?? "-"}`);
  const wh = await api("/api/stripe/webhook", { method: "POST", body: { fake: true } });
  check("webhook 缺签名/未配置 → 非 2xx 带 code（Stripe 按重试策略重发）",
    wh.status >= 400 && typeof wh.json.code === "string", `HTTP ${wh.status} code=${wh.json.code}`);
  const dom = await api("/api/payment/domestic", { method: "POST", token, body: { type: "points" } });
  check("国内支付占位 → 501 DOMESTIC_PAYMENT_PENDING（含 alipay/wechat 规划）",
    dom.status === 501 && dom.json.code === "DOMESTIC_PAYMENT_PENDING" &&
    Array.isArray(dom.json.details?.plannedProviders) && dom.json.details.plannedProviders.includes("alipay"));
} catch (err) {
  console.error("smoke crashed:", err);
  failures += 1;
} finally {
  await pool.end().catch(() => {});
}

failures += results.filter((r) => !r.ok).length;
console.log(`\n=== Phase 5-11 smoke: ${results.length - failures}/${results.length} passed ===`);
process.exit(failures ? 1 : 0);
