// 艾比平台 Phase 5 · 前端商店/卡包/背包/开包动画 契约测试（2026-09-30）
// 覆盖：
//  1) aibi-visual 纯函数（稀有度五档动画映射 / 物种 emoji 覆盖 12 种 / 颜色单源）
//  2) 新增 API：GET /api/bag/aibis（鉴权 + owner 同查询）、GET /api/aibi/list（公开目录）
//  3) 三个新页面（packs / packs/result / bag）+ soul-cards 挂载 AibiSoulPanel
//  4) 组件接线：商店(5.1)、结果页(5.2，先取结果再播动画 + StrictMode 防双开)、
//     背包(5.3)、灵魂卡面板(5.4)、详情弹窗互动(5.5)、动画组件五档/跳过/降级(5.6)
//  5) i18n aibi 命名空间 zh/en 深键对齐 + nav 新键 + SiteHeader 入口
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  AIBI_SPECIES_EMOJI,
  AIBI_ITEM_EMOJI,
  aibiSpeciesEmoji,
  aibiItemEmoji,
  animationTierForRarity,
  rarityVisual,
} from "../src/lib/aibi-visual.ts";
import { AIBI_SPECIES, AIBI_RARITIES, AIBI_ITEMS } from "../src/lib/aibi-catalog.ts";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const exists = (rel) => existsSync(join(ROOT, rel));

// === 1) aibi-visual 纯函数 ===
test("aibi-visual: 稀有度 → 动画档位五档映射（5.2）", () => {
  assert.equal(animationTierForRarity("common"), 1); // 落卡+简单光效
  assert.equal(animationTierForRarity("rare"), 2); // 翻转+元素光效
  assert.equal(animationTierForRarity("epic"), 3); // 背景+光柱+展开
  assert.equal(animationTierForRarity("legendary"), 4); // 全屏+放大+凭证编号
  assert.equal(animationTierForRarity("mythic"), 5); // 全屏+凭证生成+AI 自我介绍
  assert.equal(animationTierForRarity("unknown"), 1, "未知档位降级到 1");
});

test("aibi-visual: 物种 emoji 覆盖全部 12 物种；稀有度颜色取自 catalog 单源", () => {
  for (const sp of AIBI_SPECIES) {
    assert.ok(AIBI_SPECIES_EMOJI[sp.id], `missing emoji for ${sp.id}`);
  }
  assert.equal(aibiSpeciesEmoji("nonexistent"), "✨", "未知物种兜底");
  for (const r of AIBI_RARITIES) {
    assert.equal(rarityVisual(r.id).color, r.color, `${r.id} 颜色必须与 catalog 一致`);
    assert.equal(rarityVisual(r.id).tier, animationTierForRarity(r.id));
  }
});

// === 2) 新增 API 路由 ===
test("api: GET /api/bag/aibis 鉴权 + 与 owner 路由同查询形态", () => {
  const src = read("src/app/api/bag/aibis/route.ts");
  assert.ok(src.includes('export const runtime = "nodejs"'));
  assert.ok(src.includes("getUserFromRequest"), "Bearer 鉴权");
  assert.ok(src.includes('aibiFail("UNAUTHORIZED", 401'), "401 统一格式");
  assert.ok(src.includes("FROM aibi_tokens t"), "aibi_tokens 主查询");
  assert.ok(src.includes("LEFT JOIN aibi_personalities"), "性格/成长 LEFT JOIN");
  assert.ok(src.includes("getAibiSpecies"), "附物种档案");
  assert.ok(src.includes("aibiOk({ count: tokens.length, tokens })"), "返回 {count,tokens}");
});

test("api: pack/list 不查询 price_cny（0026 schema 无此列，Phase 4 残留 bug 回归锁）", () => {
  const src = read("src/app/api/pack/list/route.ts");
  assert.ok(!src.includes("price_cny"), "aibi_packs 无 price_cny 列（0026 唯一数据源）");
  assert.ok(src.includes('price_points AS "pricePoints"'));
  assert.ok(src.includes("aibiCatch"), "统一异常出口");
});

test("api: GET /api/aibi/list 公开目录 + 每物种已铸数量", () => {
  const src = read("src/app/api/aibi/list/route.ts");
  assert.ok(src.includes('export const runtime = "nodejs"'));
  assert.ok(!src.includes("getUserFromRequest"), "公开接口不鉴权");
  assert.ok(src.includes("FROM mint_logs"), "mint_logs 权威口径");
  assert.ok(src.includes("AIBI_SPECIES.map"), "目录单源 catalog");
  assert.ok(src.includes("getAibiRarity"), "附稀有度档案");
  assert.ok(src.includes("aibiOk({ count: species.length, species })"));
});

// === 3) 页面存在与挂载 ===
test("pages: packs / packs/result / bag 页面存在；soul-cards 挂载 AibiSoulPanel", () => {
  assert.ok(exists("src/app/[locale]/packs/page.tsx"), "packs page");
  assert.ok(exists("src/app/[locale]/packs/result/page.tsx"), "packs/result page");
  assert.ok(exists("src/app/[locale]/bag/page.tsx"), "bag page");
  assert.ok(read("src/app/[locale]/packs/page.tsx").includes("<PacksClient />"));
  const result = read("src/app/[locale]/packs/result/page.tsx");
  assert.ok(result.includes("<Suspense"), "useSearchParams 需 Suspense 边界");
  assert.ok(result.includes("<PackResultClient />"));
  assert.ok(read("src/app/[locale]/bag/page.tsx").includes("<BagClient />"));
  const soul = read("src/app/[locale]/soul-cards/page.tsx");
  assert.ok(soul.includes("<AibiSoulPanel />"), "5.4 艾比板块挂载");
  assert.ok(soul.includes("<SoulCardsClient />"), "V1 板块保留");
});

// === 4) 组件接线 ===
test("packs-client(5.1): pack/list + pack/buy + 成功跳结果页 + 骨架屏 + 登录引导", () => {
  const src = read("src/components/aibi/packs-client.tsx");
  assert.ok(src.includes('"/api/pack/list"'), "GET /api/pack/list");
  assert.ok(src.includes('"/api/pack/buy"'), "POST /api/pack/buy");
  assert.ok(src.includes("router.push(`/packs/result?packId="), "5.1.5 购买成功跳开包结果页");
  assert.ok(src.includes("animate-pulse"), "骨架屏");
  assert.ok(src.includes("readAibiToken"), "登录态判定");
  assert.ok(src.includes('href="/login"'), "未登录登录引导");
  assert.ok(src.includes("rarityWeights"), "5.1.2 稀有度概率展示");
  assert.ok(src.includes("AibiErrorBanner"), "5.1.6 错误码展示");
});

test("pack-result-client(5.2/5.6.5): 先取结果再播动画 + StrictMode 防双开 + 三按钮", () => {
  const src = read("src/components/aibi/pack-result-client.tsx");
  assert.ok(src.includes('"/api/pack/open"'), "POST /api/pack/open");
  assert.ok(src.includes("startedRef"), "StrictMode 双跑守卫（防重复消耗卡包）");
  // 先取结果再播动画：setResult(data) 之后才 setStage('animating')，动画组件条件渲染
  const setResultIdx = src.indexOf("setResult(data)");
  const animatingIdx = src.indexOf('setStage("animating")');
  assert.ok(setResultIdx > -1 && animatingIdx > setResultIdx, "接口结果先于动画阶段");
  assert.ok(src.includes('stage === "animating"') && src.includes("<PackOpenAnimation"), "动画在结果后挂载");
  assert.ok(src.includes("animationTierForRarity(result.rarity)"), "按稀有度参数化档位");
  for (const key of ['t("viewDetail")', 't("openAnother")', 't("backToBag")']) {
    assert.ok(src.includes(key), `5.2.4 按钮 ${key}`);
  }
  assert.ok(src.includes("<AibiDetailModal"), "查看详情弹窗");
});

test("bag-client(5.3): bag/aibis + bag/items + bag/use + 分组 + 卡片进详情", () => {
  const src = read("src/components/aibi/bag-client.tsx");
  assert.ok(src.includes('"/api/bag/aibis"'), "5.3.1 艾比列表");
  assert.ok(src.includes('"/api/bag/items"'), "5.3.2 道具列表");
  assert.ok(src.includes('"/api/bag/use"'), "5.3.5 使用道具");
  assert.ok(src.includes("<AibiCard"), "5.3.1 复用 AibiCard");
  assert.ok(src.includes("onClick={() => setDetail(tk)}"), "5.3.4 卡片点击进详情");
  assert.ok(src.includes('t("packsTitle"') && src.includes('t("itemsTitle"'), "5.3.3 卡包/消耗品分组");
  assert.ok(src.includes("pickTarget"), "用道具选目标艾比");
  assert.ok(src.includes("onStateChange={syncState}"), "互动后状态回写");
  assert.ok(src.includes("/packs/result?packId="), "背包卡包跳开包页");
});


test("aibi-soul-panel(5.4): supply + aibi/list + owner/:wallet + 详情弹窗", () => {
  const src = read("src/components/aibi/aibi-soul-panel.tsx");
  assert.ok(src.includes('"/api/aibi/supply"'), "5.4.2 供应看板");
  assert.ok(src.includes('"/api/aibi/list"'), "5.4.3 可铸列表");
  assert.ok(src.includes("`/api/aibi/owner/${encodeURIComponent(userId)}`"), "5.4.1 持有列表");
  assert.ok(src.includes("/api/user/profile"), "用户 ID 来源");
  assert.ok(src.includes("<AibiCard"), "持有卡片复用 AibiCard");
  assert.ok(src.includes("<AibiDetailModal"), "5.4.4 详情弹窗（凭证/成长/互动）");
});

test("aibi-detail-modal(5.5): interact 四动作 + 实时状态 + 升级动画", () => {
  const src = read("src/components/aibi/aibi-detail-modal.tsx");
  assert.ok(src.includes('"/api/interact"'), "POST /api/interact");
  assert.ok(src.includes("{ tokenId: token.aibiTokenId, action }"), "tokenId+action 请求体");
  for (const a of ['"feed"', '"train"', '"talk"', '"play"']) {
    assert.ok(src.includes(a), `动作 ${a}`);
  }
  assert.ok(src.includes("setState(res.state)"), "5.5.3 互动后实时更新状态");
  assert.ok(src.includes("res.leveledUp"), "5.5.4 升级检测");
  assert.ok(src.includes("aibi-levelup-kf"), "升级动画关键帧");
});

test("pack-open-animation(5.6): 五档参数化 + 跳过 + 移动端降级 + transform-only 关键帧", () => {
  const src = read("src/components/aibi/pack-open-animation.tsx");
  for (const tier of ["1:", "2:", "3:", "4:", "5:"]) {
    assert.ok(src.includes(tier), `TIER_TIMING 档位 ${tier}`);
  }
  assert.ok(src.includes("{t(\"skip\")}"), "5.6.2 跳过按钮");
  assert.ok(src.includes("prefers-reduced-motion"), "减动效降级");
  assert.ok(src.includes("max-width: 640px"), "5.6.4 移动端窄屏降级");
  assert.ok(src.includes("onReveal"), "动画结束回调");
  assert.ok(src.includes("aibi-beam"), "光柱（tier≥3）");
  assert.ok(src.includes("aibi-forge"), "凭证生成动画（tier≥4/5）");
  assert.ok(src.includes('t("selfIntro"'), "AI 自我介绍（tier=5）");
  // 性能：关键帧只允许 transform/opacity（不动 layout，不阻塞主线程）
  const kf = src.slice(src.indexOf("const KEYFRAMES"));
  const animatedProps = [...kf.matchAll(/animation:\s*\S+/g)].length;
  assert.ok(animatedProps >= 8, "动画类齐全");
  assert.ok(!/@keyframes[^{]*\{[^}]*(?:width|height|top|left|margin|padding):/.test(kf), "关键帧不动 layout 属性");
});

test("aibi-client: Bearer + x-locale + {data}/{code,message} 解包", () => {
  const src = read("src/lib/aibi-client.ts");
  assert.ok(src.includes('localStorage.getItem("aiabw_token")') || src.includes('window.localStorage.getItem("aiabw_token")'));
  assert.ok(src.includes("Authorization") && src.includes("Bearer"), "Bearer 头");
  assert.ok(src.includes('headers["x-locale"]'), "x-locale 头（服务端双语 message）");
  assert.ok(src.includes("json.code") && src.includes("json.message"), "错误解包");
  assert.ok(src.includes("return json.data"), "成功解包 {data}");
});

// === 5) i18n + 导航 ===
test("i18n: aibi 命名空间 zh/en 深键完全对齐 + nav 新键", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  const flatten = (o, p = "") =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === "object" ? flatten(v, `${p}${k}.`) : [`${p}${k}`],
    );
  const zhKeys = flatten(zh.aibi).sort();
  const enKeys = flatten(en.aibi).sort();
  assert.deepEqual(zhKeys, enKeys, "aibi 命名空间 zh/en 键必须一一对应");
  for (const ns of ["packs", "packOpen", "bag", "interact", "soul", "fuse", "burn", "shop"]) {
    assert.ok(zh.aibi[ns] && en.aibi[ns], `缺命名空间 ${ns}`);
  }
  assert.equal(typeof zh.nav.packs, "string");
  assert.equal(typeof zh.nav.bag, "string");
  assert.equal(typeof zh.nav.shop, "string");
  assert.equal(typeof en.nav.packs, "string");
  assert.equal(typeof en.nav.bag, "string");
  assert.equal(typeof en.nav.shop, "string");
});

test("nav: SiteHeader 五主入口（C2 决策 2026-09-30）", () => {
  const src = read("src/components/layout/SiteHeader.tsx");
  assert.ok(src.includes('{ href: "/pets", label: t("navAdoptMy") }'), "领养/我的艾比主入口");
  assert.ok(src.includes('{ href: "/packs", label: t("navPackShop") }'), "卡包商店主入口");
  assert.ok(src.includes('{ href: "/bag", label: t("navBagFusion") }'), "背包/融合主入口");
  assert.ok(src.includes('{ href: "/soul-cards", label: t("navSoulCodex") }'), "灵魂卡/图鉴主入口");
  assert.ok(src.includes('{ href: "/blindbox", label: t("navBlindbox") }'), "盲盒广场主入口");
  // 次要入口保留在「更多」：道具商店/图鉴 href 仍需存在
  assert.ok(src.includes('{ href: "/shop", label: t("shop") }'), "道具商店入口（6.3，收纳进更多）");
  assert.ok(src.includes('{ href: "/codex", label: t("codex") }'), "图鉴入口（收纳进更多）");
});

// === 6) Phase 6 · 融合 / 销毁 / 道具商店（2026-09-30） ===
test("fusion-modal(6.1): 2~5 素材选择 + /api/aibi/fuse + 结果动画 + 父级刷新", () => {
  const src = read("src/components/aibi/fusion-modal.tsx");
  assert.ok(src.includes('"/api/aibi/fuse"'), "POST /api/aibi/fuse");
  assert.ok(src.includes("body: { tokenIds: picked }"), "tokenIds 请求体");
  assert.ok(
    src.includes("const MIN_MATERIALS = 2") && src.includes("const MAX_MATERIALS = 5"),
    "素材数量与服务端 FUSION_MIN/FUSION_MAX 一致",
  );
  assert.ok(src.includes("getAibiRarity"), "结果稀有度预览 = 素材最高档（与服务端规则同源）");
  assert.ok(src.includes('"picking" | "absorb" | "reveal"'), "选择→聚合→揭晓三阶段");
  assert.ok(src.includes("fm-shrink") && src.includes("fm-core") && src.includes("fm-reveal"),
    "6.1.4 结果动画关键帧");
  assert.ok(src.includes("prefers-reduced-motion"), "减动效降级");
  assert.ok(src.includes("onFused(res)"), "成功后通知父级刷新背包");
  assert.ok(src.includes("<AibiCard"), "揭晓展示新艾比卡片");
  assert.ok(src.includes("result.minted.aibiTokenId"), "展示新凭证编号");
  assert.ok(src.includes("onViewDetail?: (tokenId: string) => void"), "6.1.5「查看详情」回调契约");
  assert.ok(src.includes('t("viewDetail")') && src.includes('t("continueFuse")'),
    "6.1.5 揭晓动作：查看详情/继续融合按钮");
  assert.ok(src.includes("function continueFuse()") && src.includes('setStage("picking")'),
    "「继续融合」重置回选择阶段");
  assert.ok(src.includes("setSpentIds") && src.includes("available.map"),
    "已消耗素材本地过滤（防父级重拉间隙复选已销毁素材）");
});

test("aibi-detail-modal 销毁(6.2): 仅持有者可见 + 二次确认 + /api/aibi/burn + onBurned", () => {
  const src = read("src/components/aibi/aibi-detail-modal.tsx");
  assert.ok(src.includes('"/api/aibi/burn"'), "POST /api/aibi/burn");
  assert.ok(src.includes("onBurned?: (tokenId: string, supplyAfter: number) => void"), "onBurned 回调契约");
  assert.ok(src.includes("{onBurned ? ("), "6.2.1 仅持有者上下文渲染销毁入口");
  assert.ok(src.includes('"idle" | "confirm" | "burning"'), "6.2.2 二次确认状态机");
  assert.ok(src.includes("onBurned?.(res.aibiTokenId, res.supplyAfter)"), "销毁成功通知父级");
});

test("bag-client Phase 6 接线: 融合入口(≥2 只) + 销毁列表实时更新", () => {
  const src = read("src/components/aibi/bag-client.tsx");
  assert.ok(src.includes("import { FusionModal"), "融合弹窗引入");
  assert.ok(src.includes("aibis.length >= 2"), "6.1.1 持有 ≥2 只才显示融合入口");
  assert.ok(src.includes('{t("fuse")}'), "融合按钮");
  assert.ok(src.includes("onFused={onFused}") && src.includes("void load()"), "融合后刷新背包");
  assert.ok(src.includes("onBurned={onBurned}"), "6.2.4 详情弹窗传入销毁回调");
  assert.ok(src.includes("prev.filter((tk) => tk.aibiTokenId !== tokenId)"), "销毁后列表实时移除");
  assert.ok(src.includes("onViewFusedDetail") && src.includes("onViewDetail={(id) => void onViewFusedDetail(id)}"),
    "6.1.5「查看详情」接线（关融合弹窗 → 重拉列表 → 打开新艾比详情）");
  assert.ok(src.includes("aibiItemEmoji"), "道具 emoji 统一来自 aibi-visual 单源");
  assert.ok(!src.includes("ITEM_EMOJI"), "本地 ITEM_EMOJI 已移除");
});

test("shop(6.3): 页面存在 + item/list + item/buy + 登录门槛", () => {
  assert.ok(exists("src/app/[locale]/shop/page.tsx"), "shop 页面存在");
  const page = read("src/app/[locale]/shop/page.tsx");
  assert.ok(page.includes("<ShopClient />"), "挂载 ShopClient");
  const src = read("src/components/aibi/shop-client.tsx");
  assert.ok(src.includes('"/api/item/list"'), "6.3.1 道具列表");
  assert.ok(src.includes('"/api/item/buy"'), "6.3.2 购买接口");
  assert.ok(src.includes("body: { itemId, quantity: qtyOf(itemId) }"), "购买请求体携带所选数量");
  assert.ok(src.includes("Math.min(99") && src.includes("Math.max(1"),
    "数量夹取 1~99（与服务端 quantity 上限一致）");
  assert.ok(src.includes('aria-label={t("quantity")}') && src.includes('type="number"'),
    "数量输入框（6.3.2）");
  assert.ok(src.includes('t("subtotal"') && src.includes("it.pricePoints * qtyOf(it.id)"),
    "小计随数量联动");
  assert.ok(src.includes("readAibiToken"), "登录门槛（与 packs 同策略）");
  assert.ok(src.includes("setBalance(res.balance)"), "购买后余额回显");
  assert.ok(src.includes("aibiItemEmoji(it.id)"), "道具 emoji 展示");
  assert.ok(src.includes("AibiErrorBanner"), "错误统一展示");
});

test("aibi-visual: 道具 emoji 覆盖 catalog 全部道具", () => {
  for (const it of AIBI_ITEMS) {
    assert.ok(AIBI_ITEM_EMOJI[it.id], `missing emoji for item ${it.id}`);
  }
  assert.equal(aibiItemEmoji("nonexistent"), "🎁", "未知道具兜底");
});

test("api 回归锁: bag/aibis 与 aibi/owner 仅返回 status='minted'（销毁/融合素材不得再出现）", () => {
  // Phase 6 冒烟暴露：两路由曾缺状态过滤，销毁后的艾比仍留在背包/持有列表
  const bag = read("src/app/api/bag/aibis/route.ts");
  assert.ok(bag.includes("t.status = 'minted'"), "bag/aibis 过滤已销毁");
  const owner = read("src/app/api/aibi/owner/[wallet]/route.ts");
  assert.ok(owner.includes("t.status = 'minted'"), "aibi/owner 过滤已销毁");
});

test("aibi-service: 销毁守卫 BURN_GUARD（冷静期/积分返还 env 开关，默认关闭）", () => {
  // 产品决策待定 → 可配置开关；默认 0=关闭时现有 API 契约/行为完全不变（响应不含 refundedPoints）
  const src = read("src/lib/aibi-service.ts");
  assert.ok(src.includes("export const BURN_GUARD"), "BURN_GUARD 配置对象");
  assert.ok(src.includes("process.env.AIBI_BURN_COOLDOWN_HOURS ?? 0"), "冷静期 env 开关（默认 0=关闭）");
  assert.ok(src.includes("process.env.AIBI_BURN_REFUND_POINTS ?? 0"), "积分返还 env 开关（默认 0=关闭）");
  assert.ok(src.includes('throw new AibiError("BURN_COOLDOWN", 429)'), "冷却期内销毁 → 429");
  assert.ok(src.includes("make_interval"), "冷却窗口基于 burn_logs.created_at");
  assert.ok(src.includes("'aibi_burn_refund'"), "返还积分流水 reason（同事务）");
  assert.ok(src.includes("refundedPoints"), "开关开启时响应附 refundedPoints");
  assert.ok(
    src.includes('opts.reason === "user_burn"'),
    "守卫仅作用于玩家主动销毁（fusion_consume / 管理员 reason 不受影响）",
  );
  const api = read("src/lib/aibi-api.ts");
  assert.ok(api.includes("BURN_COOLDOWN"), "错误目录含 BURN_COOLDOWN 双语 message");
});

