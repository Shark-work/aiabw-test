#!/usr/bin/env node
/**
 * 全量冒烟 · P0 概念收敛 + P1 七需求 + P2 社交传播（23 用例）
 * ============================================================
 * 覆盖 2026-10-14 三个批次的上线验收：
 *   P0 概念收敛（6）：唤醒即铸卡 / 收藏中心双 Tab / 艾比凭证停售停铸 /
 *     i18n 话语统一 / 邀请返利 VIP / 断签补签 Xorpay
 *   P1 七需求（9）：新手引导完成标记 / 探索产出外显 / 探索履历 / 明信片墙（本人）/
 *     灵魂卡故事线 / 卡面成长阶段 / 签到 streak / 我的灵宠聚合页 / 羁绊结晶端点
 *   P2 社交传播（8）：灵魂卡分享图 / 灵魂卡公开页 / 公开页负例 / 明信片墙隐私门 /
 *     开关开→公开可读 / 墙分享图+隐私回滚 / 季节活动骨架 / 回来看看
 *
 * 用法（PowerShell，仓库根目录）：
 *   $env:SMOKE_BASE="https://www.aiabw.com"   # 默认即此值；preview 部署可覆盖
 *   node scripts/smoke-full.mjs
 *
 * 与 scripts/smoke-production.mjs 的分工：
 *   - 本脚本 = 三批新功能的端到端验收（纯 HTTP，无需 DATABASE_URL）；
 *   - smoke-production.mjs = 基础交易链路深度回归（SQL 充值/商城/支付，52 步）。
 *
 * ⚠️ 会在目标环境留下测试痕迹（append-only，均为新用户正常行为，零积分成本）：
 *   1 个用户（full-smoke-<ts>@test.dev）+ 1 只唤醒灵宠 + 1 张灵魂卡 +
 *   1 条探索记录 + 1 次签到 + 成就解锁（first-explore 等）。清理 SQL 见 docs/RELEASE_CHECKLIST.md 附录。
 *
 * 输出：逐用例 ✅/❌ + 分组汇总报告；全绿输出 ALL_SMOKE_FULL_OK，退出码 0；任一失败退出码 1。
 */

const BASE = (process.env.SMOKE_BASE ?? "https://www.aiabw.com").replace(/\/+$/, "");
console.log(`SMOKE_BASE = ${BASE}\n`);

/* ── 报告器 ─────────────────────────────────────────────────── */
const groups = {
  P0: { label: "P0 概念收敛", total: 6, pass: 0 },
  P1: { label: "P1 七需求", total: 9, pass: 0 },
  P2: { label: "P2 社交传播", total: 8, pass: 0 },
};
let ran = 0;
const failedCases = [];

function check(group, no, name, ok, detail = "") {
  ran += 1;
  const g = groups[group];
  if (ok) {
    g.pass += 1;
    console.log(`[${group}-${no}] ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failedCases.push(`${group}-${no} ${name}`);
    console.log(`[${group}-${no}] ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ── HTTP helpers ───────────────────────────────────────────── */
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
  try { json = JSON.parse(raw); } catch { /* HTML/非 JSON */ }
  return { status: res.status, json, raw };
}

/** 二进制响应（分享图）：返回字节数与 content-type。 */
async function apiBin(pathname, { token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${pathname}`, { headers });
  const buf = await res.arrayBuffer();
  return { status: res.status, bytes: buf.byteLength, contentType: res.headers.get("content-type") ?? "" };
}

/** 失败详情压缩（用于 ❌ 行 detail）。 */
function preview(r) {
  const body = (r.raw ?? "").slice(0, 160).replace(/\s+/g, " ");
  return `HTTP ${r.status} body=${body}`;
}

/* ── 冒烟账号 ───────────────────────────────────────────────── */
const ts = Date.now();
const email = `full-smoke-${ts}@test.dev`;
const password = "smoke-pass-123";
const username = `smoke${String(ts).slice(-8)}`;

try {
  /* ══ 准备：注册（响应直发 token；失败兜底 login）══ */
  const reg = await api("/api/auth/register", { method: "POST", body: { email, password, username } });
  let token = reg.json?.token;
  let userId = reg.json?.user?.id;
  if (!token) {
    const login = await api("/api/auth/login", { method: "POST", body: { email, password } });
    token = login.json?.token;
    userId = login.json?.user?.id;
  }
  if (!token || !userId) {
    throw new Error(`冒烟账号注册/登录失败：HTTP ${reg.status} ${reg.raw.slice(0, 200)}`);
  }
  console.log(`冒烟账号：${email}（id=${userId}）\n`);

  /* ════════════════ P0 概念收敛（6）════════════════ */

  // P0-1 唤醒即铸卡端到端：onboarding 候选 → claim → 自动铸造灵魂卡（soulCard.certificateNo）
  const ob0 = await api("/api/onboarding", { token });
  const candidatePetId = ob0.json?.candidate?.petId;
  const claim = candidatePetId
    ? await api("/api/pets/claim", { method: "POST", token, body: { petId: candidatePetId } })
    : { status: 0, json: {}, raw: "no candidate" };
  const claimCert = claim.json?.soulCard?.certificateNo ?? null;
  check("P0", 1, "唤醒即铸卡：候选→claim→自动铸造（certificateNo）",
    ob0.status === 200 && !!candidatePetId && claim.status === 200 && typeof claimCert === "string" && claimCert.length > 0,
    claimCert ? `certificateNo=${claimCert}` : `${preview(ob0)} | ${preview(claim)}`);

  // 领取灵魂卡 id（后续 P1/P2 用例共用；claim 响应不保证带 id，统一从列表取）
  const myCards = await api("/api/soul-cards", { token });
  const cardId = myCards.json?.cards?.[0]?.id ?? null;
  const cardCert = myCards.json?.cards?.[0]?.certificateNo ?? claimCert;
  if (!cardId) console.log("  ⚠️ /api/soul-cards 无卡，后续灵魂卡用例将失败");

  // P0-2 收藏中心双 Tab：/soul-cards（soul 默认）+ ?tab=nfr 世界藏品
  const tabSoul = await api("/zh/soul-cards");
  const tabNfr = await api("/zh/soul-cards?tab=nfr");
  check("P0", 2, "收藏中心双 Tab：/zh/soul-cards + ?tab=nfr 均可达",
    tabSoul.status === 200 && tabNfr.status === 200,
    tabSoul.status !== 200 ? preview(tabSoul) : tabNfr.status !== 200 ? preview(tabNfr) : "");

  // P0-3 艾比凭证停售 + 停铸：pack/buy → 410 DISCONTINUED；pack/open → 410 或 400 无包
  const buy = await api("/api/pack/buy", { method: "POST", token, body: { packId: "summon", quantity: 1 } });
  const open = await api("/api/pack/open", { method: "POST", token, body: { packId: "summon" } });
  check("P0", 3, "停售/停铸：pack/buy 410 DISCONTINUED + pack/open 410|400",
    buy.status === 410 && buy.json?.code === "DISCONTINUED" &&
    ((open.status === 410 && open.json?.code === "DISCONTINUED") ||
      (open.status === 400 && open.json?.code === "INSUFFICIENT_ITEM")),
    `buy=${buy.status}/${buy.json?.code} open=${open.status}/${open.json?.code}`);

  // P0-4 i18n 话语统一：首页与收藏中心 HTML 不含「NFT」表述
  const homeHtml = await api("/zh/");
  const collHtml = await api("/zh/soul-cards");
  const nftHit = [homeHtml, collHtml].some((r) => /\bNFT\b/.test(r.raw));
  check("P0", 4, "i18n 话语统一：/zh/ 与 /zh/soul-cards 无 NFT 字样",
    homeHtml.status === 200 && collHtml.status === 200 && !nftHit,
    nftHit ? "检测到 NFT 字样" : "");

  // P0-5 邀请返利 VIP：匿名 401；登录 200 + inviteCode + vipDays
  const refAnon = await api("/api/referral");
  const refAuth = await api("/api/referral", { token });
  const refJ = refAuth.json;
  check("P0", 5, "邀请返利：GET /api/referral 匿名 401 + 登录 200（inviteCode/vipDays）",
    refAnon.status === 401 && refAuth.status === 200 &&
    typeof (refJ?.inviteCode ?? refJ?.data?.inviteCode) === "string" &&
    typeof (refJ?.vipDays ?? refJ?.data?.vipDays ?? refJ?.stats?.vipDays) === "number",
    refAuth.status !== 200 ? preview(refAuth) : `inviteCode=${refJ?.inviteCode ?? refJ?.data?.inviteCode}`);

  // P0-6 断签补签 Xorpay：新用户无连签 → 400 NO_STREAK_TO_MAKEUP（零外部调用）
  const makeup = await api("/api/pay/create", { method: "POST", token, body: { kind: "checkin_makeup" } });
  check("P0", 6, "断签补签：无连签 → 400 NO_STREAK_TO_MAKEUP",
    makeup.status === 400 && makeup.json?.code === "NO_STREAK_TO_MAKEUP",
    makeup.json?.code ?? preview(makeup));

  /* ════════════════ P1 七需求（9）════════════════ */

  // P1-1 新手引导完成标记：POST /api/onboarding 幂等 → GET completed=true + hasPet=true
  const obDone = await api("/api/onboarding", { method: "POST", token });
  const obAfter = await api("/api/onboarding", { token });
  check("P1", 1, "新手引导：完成标记幂等（completed=true + hasPet=true）",
    obDone.status === 200 && obAfter.status === 200 &&
    obAfter.json?.completed === true && obAfter.json?.hasPet === true,
    obAfter.status !== 200 ? preview(obAfter) : `completed=${obAfter.json?.completed} hasPet=${obAfter.json?.hasPet}`);

  // P1-2 探索产出外显：首次探索 200 + event.id + 成就联动（newlyUnlocked 含 first-explore）
  const start = await api("/api/exploration/start", { method: "POST", token });
  const eventId = start.json?.event?.id ?? null;
  const firstExplore = Array.isArray(start.json?.newlyUnlocked)
    ? start.json.newlyUnlocked.find((b) => b?.id === "first-explore")
    : null;
  check("P1", 2, "探索产出：start 200 + event.id + 首探索徽章 first-explore",
    start.status === 200 && start.json?.ok === true && typeof eventId === "string" && !!firstExplore,
    eventId ? `event=${eventId} resultType=${start.json?.event?.resultType ?? "?"}` : preview(start));

  // P1-3 探索履历：history 首条 = 刚才的探索事件
  const history = await api("/api/exploration/history?limit=5", { token });
  const histFirst = history.json?.records?.[0];
  check("P1", 3, "探索履历：history[0].eventId 与本次探索一致",
    history.status === 200 && history.json?.ok === true && !!histFirst && histFirst.eventId === eventId,
    histFirst ? `history[0]=${histFirst.eventId} title=${histFirst.title ?? "?"}` : preview(history));

  // P1-4 明信片墙（本人视角）：cards + collections 双区结构
  const wall = await api("/api/exploration/postcard-wall", { token });
  check("P1", 4, "明信片墙（本人）：GET 200 + cards/collections 双区",
    wall.status === 200 && wall.json?.ok === true &&
    Array.isArray(wall.json?.cards) && Array.isArray(wall.json?.collections),
    wall.status === 200
      ? `cards=${wall.json?.cards?.length} collections=${wall.json?.collections?.length}`
      : preview(wall));

  // P1-5 灵魂卡故事线：story 聚合（mintedAt + explorationCount≥1）
  const story = cardId ? await api(`/api/soul-cards/${cardId}/story`, { token }) : { status: 0, json: {}, raw: "no cardId" };
  check("P1", 5, "灵魂卡故事线：story.mintedAt + explorationCount≥1",
    story.status === 200 && story.json?.ok === true &&
    !!story.json?.story?.mintedAt && Number(story.json?.story?.explorationCount) >= 1,
    story.status === 200
      ? `explorations=${story.json?.story?.explorationCount} postcards=${story.json?.story?.postcardCount}`
      : preview(story));

  // P1-6 卡面成长阶段：新卡初始档 seed（growthStage 字段随卡返回）
  const stage = myCards.json?.cards?.[0]?.growthStage ?? null;
  check("P1", 6, "卡面成长阶段：新卡 growthStage=seed",
    myCards.status === 200 && stage === "seed",
    `growthStage=${stage}`);

  // P1-7 签到 streak 持久化：POST → streak=1 + checkinDate；GET 状态可读
  const checkinPost = await api("/api/user/checkin", { method: "POST", token });
  const checkinGet = await api("/api/user/checkin", { token });
  check("P1", 7, "签到：POST streak=1 + checkinDate 持久化（GET 200）",
    checkinPost.status === 200 && checkinPost.json?.ok === true &&
    Number(checkinPost.json?.streak) === 1 && !!checkinPost.json?.checkinDate &&
    checkinGet.status === 200,
    `streak=${checkinPost.json?.streak} date=${checkinPost.json?.checkinDate}`);

  // P1-8 我的灵宠聚合页：/pets/my（单页双 Tab 载体，/my-pets 已 308 至此）
  const petsMy = await api("/zh/pets/my");
  check("P1", 8, "我的灵宠聚合页 /zh/pets/my 可达",
    petsMy.status === 200, petsMy.status !== 200 ? preview(petsMy) : "");

  // P1-9 羁绊结晶端点：假亲本 404（叙事化繁育入口存活，零副作用）
  const breed404 = await api("/api/pets/breed", {
    method: "POST", token,
    body: { parentIds: ["00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000001"] },
  });
  check("P1", 9, "羁绊结晶：breed 假亲本 → 404 parentNotFound",
    breed404.status === 404 && /亲本|Parent/i.test(breed404.json?.error ?? ""),
    `HTTP ${breed404.status} ${breed404.json?.error ?? ""}`);

  /* ════════════════ P2 社交传播（8）════════════════ */

  // P2-1 灵魂卡分享图：登录 200 + image/png + 真实图片体积（阶段徽章+箴言渲染未崩）
  const shareImg = cardId ? await apiBin(`/api/soul-cards/${cardId}/share.png`, { token }) : { status: 0, bytes: 0, contentType: "no cardId" };
  check("P2", 1, "灵魂卡分享图 share.png 200 + image/png（>5KB）",
    shareImg.status === 200 && shareImg.contentType.includes("png") && shareImg.bytes > 5000,
    `${shareImg.status} ${shareImg.contentType} ${shareImg.bytes}B`);

  // P2-2 灵魂卡公开页：匿名 200 + 含证书编号 + noindex（OG 元标签供爬虫）
  const pubPage = cardId ? await api(`/zh/soul-cards/${cardId}/public`) : { status: 0, raw: "no cardId" };
  check("P2", 2, "灵魂卡公开页：匿名 200 + 证书编号 + noindex",
    pubPage.status === 200 && !!cardCert && pubPage.raw.includes(cardCert) && pubPage.raw.includes("noindex"),
    pubPage.status !== 200 ? `HTTP ${pubPage.status}` : `cert=${cardCert} in HTML`);

  // P2-3 公开页负例：不存在的卡 → 404（防探测口径）
  const pubMiss = await api("/zh/soul-cards/00000000-0000-0000-0000-000000000000/public");
  check("P2", 3, "公开页负例：不存在的卡 → 404",
    pubMiss.status === 404, `HTTP ${pubMiss.status}`);

  // P2-4 明信片墙隐私门：默认关 → 公开 API 404 + 公开页 404（不泄露开关状态）
  const wallApiClosed = await api(`/api/postcard-wall/${userId}`);
  const wallPageClosed = await api(`/zh/postcard-wall/${userId}`);
  check("P2", 4, "明信片墙隐私门：默认关 → API 404 + 页面 404",
    wallApiClosed.status === 404 && wallPageClosed.status === 404,
    `api=${wallApiClosed.status} page=${wallPageClosed.status}`);

  // P2-5 开关开启 → 公开可读：PATCH true → API 200（owner/cards/collections）+ 页面 200
  const patchOn = await api("/api/user/profile", { method: "PATCH", token, body: { postcardWallPublic: true } });
  const wallApiOpen = await api(`/api/postcard-wall/${userId}`);
  const wallPageOpen = await api(`/zh/postcard-wall/${userId}`);
  check("P2", 5, "开关开启 → 公开 API 200（owner/cards/collections）+ 公开页 200",
    patchOn.status === 200 && wallApiOpen.status === 200 && wallApiOpen.json?.ok === true &&
    !!wallApiOpen.json?.owner && Array.isArray(wallApiOpen.json?.cards) &&
    Array.isArray(wallApiOpen.json?.collections) && wallPageOpen.status === 200,
    wallApiOpen.status === 200
      ? `owner=${wallApiOpen.json?.owner?.username ?? "?"} cards=${wallApiOpen.json?.cards?.length}`
      : `patch=${patchOn.status} api=${wallApiOpen.status} page=${wallPageOpen.status}`);

  // P2-6 墙分享图 + 隐私回滚：share.png 200 png → PATCH false → 公开 API 回 404
  const wallImg = await apiBin(`/api/postcard-wall/${userId}/share.png`);
  const patchOff = await api("/api/user/profile", { method: "PATCH", token, body: { postcardWallPublic: false } });
  const wallApiReclosed = await api(`/api/postcard-wall/${userId}`);
  check("P2", 6, "墙分享图 200 png + 关闭开关后公开 API 回 404（隐私回滚）",
    wallImg.status === 200 && wallImg.contentType.includes("png") && wallImg.bytes > 5000 &&
    patchOff.status === 200 && wallApiReclosed.status === 404,
    `img=${wallImg.status}/${wallImg.bytes}B off=${patchOff.status} reclosed=${wallApiReclosed.status}`);

  // P2-7 季节活动骨架：匿名 200 + event 字段存在（占位活动 is_active=false → null；
  //      运营后台激活后非 null 属正常，故断言存在性而非值）
  const seasonal = await api("/api/seasonal-events/active");
  check("P2", 7, "季节活动：active 匿名 200 + event 字段存在（占位 null 正常）",
    seasonal.status === 200 && seasonal.json?.ok === true && "event" in (seasonal.json ?? {}),
    `event=${JSON.stringify(seasonal.json?.event ?? null)}`);

  // P2-8 回来看看：匿名 401；登录 200 + reminders 数组（新用户通常为空数组）
  const recallAnon = await api("/api/home/recall");
  const recallAuth = await api("/api/home/recall", { token });
  check("P2", 8, "回来看看：匿名 401 + 登录 200 + reminders 数组",
    recallAnon.status === 401 && recallAuth.status === 200 &&
    recallAuth.json?.ok === true && Array.isArray(recallAuth.json?.reminders),
    recallAuth.status === 200 ? `reminders=${recallAuth.json?.reminders?.length}` : preview(recallAuth));

} catch (err) {
  failedCases.push("CRASH 脚本异常中断");
  console.error(`\n❌ smoke-full crashed：`, err);
}

/* ════════════════ 分组汇总报告 ════════════════ */
console.log("\n════════════ 全量冒烟报告（P0+P1+P2）════════════");
for (const [key, g] of Object.entries(groups)) {
  const ok = g.pass === g.total;
  console.log(`${ok ? "✅" : "❌"} ${g.label.padEnd(12)} ${g.pass}/${g.total}`);
}
const totalPass = Object.values(groups).reduce((s, g) => s + g.pass, 0);
const totalAll = Object.values(groups).reduce((s, g) => s + g.total, 0);
console.log(`──────────────────────────────────────────────`);
console.log(`总计 ${totalPass}/${totalAll} 通过（执行 ${ran} 个检查点）`);
if (failedCases.length > 0) {
  console.log(`\n失败用例：`);
  for (const c of failedCases) console.log(`  ❌ ${c}`);
  console.log(`\n提示：先按 docs/RELEASE_CHECKLIST.md 阶段 2 确认数据库迁移已到 v18，再按 docs/ROLLBACK_GUIDE.md 判断点表处置。`);
  process.exit(1);
}
console.log(`\nALL_SMOKE_FULL_OK`);
process.exit(0);

