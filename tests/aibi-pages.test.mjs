// 艾比平台 Phase 7 + Phase 8 契约测试（2026-09-30）
// 覆盖：
//  1) Phase 8 · AibiCard 五档动态角色卡：五档动效标记 / 卡面要素 / 悬停浮层 / 点击进详情 / CSS 关键帧与降级
//  2) Phase 7 · 新增只读服务：readSpotlight / readTokenDetail（脱敏）/ readUserAibiSummary / readSupplyHistory
//  3) 新增 API：/api/aibi/spotlight、/api/aibi/token/[tokenId]、/api/aibi/profile、/api/aibi/supply 扩展
//  4) 四个新页面（codex / aibi/[tokenId] / profile / supply）+ 首页艾比区块 + 导航入口
//  5) i18n 新命名空间 zh/en 深键对齐
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  AIBI_ELEMENT_I18N,
  aibiElementLabel,
  aibiCertDisplay,
  speciesCardToken,
} from "../src/lib/aibi-visual.ts";
import { AIBI_SPECIES } from "../src/lib/aibi-catalog.ts";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const exists = (rel) => existsSync(join(ROOT, rel));

// === 1) aibi-visual 展示助手 ===
test("visual: 元素中英映射覆盖全部物种元素；未知元素原样返回", () => {
  for (const sp of AIBI_SPECIES) {
    assert.ok(AIBI_ELEMENT_I18N[sp.element], `missing element i18n for ${sp.element} (${sp.id})`);
  }
  assert.equal(aibiElementLabel("自然", "zh"), "自然");
  assert.equal(aibiElementLabel("自然", "en"), "Nature");
  assert.equal(aibiElementLabel("未知元素", "en"), "未知元素");
});

test("visual: aibiCertDisplay 凭证号展示格式（Aibi #000128），空值显示 —", () => {
  assert.equal(aibiCertDisplay("AIBI-000128"), "Aibi #000128");
  assert.equal(aibiCertDisplay(""), "—");
});

test("visual: speciesCardToken 物种 → 卡片 DTO 适配（图鉴统一 AibiCard）", () => {
  const sp = AIBI_SPECIES[0];
  const tk = speciesCardToken(sp);
  assert.equal(tk.aibiTokenId, "");
  assert.equal(tk.speciesId, sp.id);
  assert.equal(tk.status, "codex");
  assert.equal(tk.species, sp);
  assert.equal(tk.growthLevel, null);
});

// === 2) Phase 8 · AibiCard 五档动态角色卡 ===
test("card: 五档动效标记齐全（呼吸/发光边框/粒子/扫掠/光柱）", () => {
  const src = read("src/components/aibi/aibi-card.tsx");
  assert.ok(src.includes("aibi-breathe"), "全档呼吸动画");
  assert.ok(src.includes("tier >= 2"), "稀有+ 档位门槛");
  assert.ok(src.includes("aibi-glow-border"), "稀有+ 发光边框");
  assert.ok(src.includes("aibi-particle-float"), "稀有+ 元素粒子");
  assert.ok(src.includes("tier >= 3"), "史诗+ 档位门槛");
  assert.ok(src.includes("aibi-beam-sweep"), "史诗+ 技能光效");
  assert.ok(src.includes("tier >= 4"), "传说+ 档位门槛");
  assert.ok(src.includes("aibi-pillar-rise"), "传说+ 登场光柱");
  assert.ok(src.includes("tier >= 5"), "神话档位门槛");
  assert.ok(src.includes("LIMITED"), "神话限量标识");
});

test("card: 卡面要素 + 交互（href 详情 / hoverInfo 浮层 / statusTag 覆盖 / 凭证编号）", () => {
  const src = read("src/components/aibi/aibi-card.tsx");
  assert.ok(src.includes("aibiCertDisplay"), "凭证编号 Aibi #000128 展示");
  assert.ok(src.includes("aibiElementLabel"), "元素展示");
  assert.ok(src.includes("getAibiHabitat"), "栖息地展示");
  assert.ok(src.includes("STATUS_I18N"), "状态标签（minted/burned/pending…）");
  assert.ok(src.includes("statusTag"), "状态标签可覆盖（图鉴拥有状态）");
  assert.ok(src.includes("hoverInfo"), "悬停更多信息浮层");
  assert.ok(src.includes("group-hover:opacity-100"), "悬停浮层 CSS 过渡");
  assert.ok(src.includes('href?: string'), "点击进入详情页 prop");
  assert.ok(src.includes("@/i18n/navigation"), "Link 跳转详情");
});

test("card: 动效关键帧在 globals.css 定义 + prefers-reduced-motion 降级", () => {
  const css = read("src/app/globals.css");
  for (const kf of [
    "aibi-breathe",
    "aibi-glow-border",
    "aibi-particle-float",
    "aibi-beam-sweep",
    "aibi-pillar-rise",
  ]) {
    assert.ok(css.includes(`@keyframes ${kf}`), `missing @keyframes ${kf}`);
  }
  assert.ok(css.includes("prefers-reduced-motion"), "移动端/减弱动效降级");
  assert.ok(css.includes(".aibi-anim"), "降级选择器与卡片根 class 对应");
});

// === 3) Phase 7 · 只读服务（aibi-service） ===
test("service: 四个页面读函数存在；公开路径脱敏（owner 仅钱包或 user-****）", () => {
  const src = read("src/lib/aibi-service.ts");
  for (const fn of ["readSpotlight", "readTokenDetail", "readUserAibiSummary", "readSupplyHistory", "readSupplySnapshots"]) {
    assert.ok(src.includes(`export async function ${fn}`), `missing ${fn}`);
  }
  assert.ok(src.includes("user-****"), "持有者脱敏展示口径");
  assert.ok(!src.includes("users.email") && !src.includes("u.email"), "公开读路径绝不返回邮箱");
  assert.ok(src.includes("LIMIT $2 OFFSET $3"), "用户中心历史分页");
  assert.ok(src.includes("UNION ALL"), "mint/burn 合并时间线");
  assert.ok(src.includes("LEFT JOIN aibi_tokens"), "burn_logs 无 species_id 列（0025）→ 经 aibi_tokens 回填物种");
});

// === 4) Phase 7 · API 路由 ===
test("api: GET /api/aibi/spotlight 公开焦点（最新铸造 + 稀有榜 + 物种档案）", () => {
  const src = read("src/app/api/aibi/spotlight/route.ts");
  assert.ok(src.includes('export const runtime = "nodejs"'));
  assert.ok(src.includes("readSpotlight"), "服务层复用");
  assert.ok(src.includes("getAibiSpecies"), "附物种档案");
  assert.ok(src.includes("aibiOk"), "统一成功格式");
});

test("api: GET /api/aibi/token/[tokenId] 公开详情（404 + 隐私剥离 + viewerIsOwner）", () => {
  const src = read("src/app/api/aibi/token/[tokenId]/route.ts");
  assert.ok(src.includes("readTokenDetail"), "服务层复用");
  assert.ok(src.includes('aibiFail("TOKEN_NOT_FOUND", 404'), "不存在 → 404");
  assert.ok(src.includes("viewerIsOwner"), "持有者可互动判定");
  assert.ok(src.includes("void ownerId"), "ownerId 剥离不下发");
  assert.ok(src.includes("getUserFromRequest"), "可选鉴权（不影响公开字段）");
});

test("api: GET /api/aibi/profile 鉴权 + 分页（8.7）", () => {
  const src = read("src/app/api/aibi/profile/route.ts");
  assert.ok(src.includes('aibiFail("UNAUTHORIZED", 401'), "401 统一格式");
  assert.ok(src.includes("readUserAibiSummary"), "服务层复用");
  assert.ok(src.includes('searchParams.get("page")'), "分页参数");
});

test("api: GET /api/aibi/supply 扩展历史与快照（向后兼容 latestSnapshot）", () => {
  const src = read("src/app/api/aibi/supply/route.ts");
  assert.ok(src.includes("readSupply"), "原有统计保留");
  assert.ok(src.includes("latestSnapshot"), "旧字段向后兼容");
  assert.ok(src.includes("readSupplyHistory"), "增发/销毁历史");
  assert.ok(src.includes("readSupplySnapshots"), "快照趋势");
  assert.ok(src.includes('searchParams.get("page")'), "分页参数");
});

// === 5) Phase 7 · 页面与组件接线 ===
test("pages: 四个新页面存在（服务端壳 + setRequestLocale + 客户端容器）", () => {
  const cases = [
    ["src/app/[locale]/codex/page.tsx", "CodexClient"],
    ["src/app/[locale]/aibi/[tokenId]/page.tsx", "AibiPageClient"],
    ["src/app/[locale]/profile/page.tsx", "ProfileClient"],
    ["src/app/[locale]/supply/page.tsx", "SupplyClient"],
  ];
  for (const [rel, client] of cases) {
    assert.ok(exists(rel), `missing ${rel}`);
    const src = read(rel);
    assert.ok(src.includes("setRequestLocale"), `${rel} setRequestLocale`);
    assert.ok(src.includes(client), `${rel} 挂载 ${client}`);
  }
});

test("components: codex 三维筛选 + 分页 + 拥有状态；详情页持有者互动入口", () => {
  const codex = read("src/components/aibi/codex-client.tsx");
  assert.ok(codex.includes("/api/aibi/list"), "物种数据源");
  assert.ok(codex.includes("/api/bag/aibis"), "拥有状态 join");
  assert.ok(codex.includes("filterRarity") && codex.includes("filterElement") && codex.includes("filterHabitat"), "三维筛选");
  assert.ok(codex.includes("PAGE_SIZE"), "分页常量");
  assert.ok(codex.includes("speciesCardToken"), "统一 AibiCard 适配");

  const detail = read("src/components/aibi/aibi-page-client.tsx");
  assert.ok(detail.includes("/api/aibi/token/"), "详情数据源");
  assert.ok(detail.includes("viewerIsOwner"), "持有者互动入口");
  assert.ok(detail.includes("provenance"), "凭证履历");
});

test("components: profile / supply / 首页区块 数据源与分页接线", () => {
  const profile = read("src/components/aibi/profile-client.tsx");
  assert.ok(profile.includes("/api/aibi/profile"), "用户中心数据源");
  assert.ok(profile.includes("/api/auth/me"), "账号信息");

  const supply = read("src/components/aibi/supply-client.tsx");
  assert.ok(supply.includes("/api/aibi/supply?page="), "看板分页数据源");
  assert.ok(supply.includes("snapshots"), "快照趋势");

  const home = read("src/components/aibi/home-aibi-section.tsx");
  assert.ok(home.includes("/api/aibi/spotlight"), "首页焦点数据源");
  for (const href of ["/packs", "/codex", "/bag", "/supply"]) {
    assert.ok(home.includes(`href="${href}"`), `首页入口 ${href}`);
  }
});

test("site: 首页挂载 HomeAibiSection；导航新增 codex/supply/profile", () => {
  const home = read("src/app/[locale]/page.tsx");
  assert.ok(home.includes("<HomeAibiSection />"), "首页艾比区块");
  const header = read("src/components/layout/SiteHeader.tsx");
  for (const href of ["/codex", "/supply", "/profile"]) {
    assert.ok(header.includes(`href: "${href}"`), `导航 ${href}`);
  }
});

// === 6) i18n 深键对齐 ===
function flatten(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") out.push(...flatten(v, key));
    else out.push(key);
  }
  return out.sort();
}

test("i18n: aibi 新命名空间（spotlight/codex/tokenPage/profilePage/supplyPage）zh/en 深键对齐", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  for (const ns of ["spotlight", "codex", "tokenPage", "profilePage", "supplyPage"]) {
    const zk = flatten(zh.aibi?.[ns]);
    const ek = flatten(en.aibi?.[ns]);
    assert.ok(zk.length > 0, `zh.aibi.${ns} 非空`);
    assert.deepEqual(ek, zk, `aibi.${ns} zh/en 键集合必须一致`);
  }
  for (const navKey of ["codex", "supply", "profile"]) {
    assert.ok(zh.nav?.[navKey], `zh.nav.${navKey}`);
    assert.ok(en.nav?.[navKey], `en.nav.${navKey}`);
  }
});

// === 7) Phase 9 · AibiStagePage 详情页舞台化（/aibi/[tokenId]） ===
test("stage(9.1): 三栏舞台布局 + 移动端单列降级 + AibiCard 五档动效复用", () => {
  const src = read("src/components/aibi/aibi-page-client.tsx");
  assert.ok(src.includes("<AibiCard"), "左栏复用 AibiCard");
  assert.ok(src.includes('size="lg"'), "舞台大卡 lg");
  assert.ok(src.includes("hoverInfo"), "悬停信息浮层");
  assert.ok(src.includes("grid-cols-1"), "移动端单列");
  assert.ok(/lg:grid-cols-\[/.test(src), "桌面三栏自定义轨宽（移动端自动堆叠）");
});

test("stage(9.2): 中栏信息面板（名称/稀有度/元素/栖息地/凭证/状态标签 + 等级/经验条/亲密度）", () => {
  const src = read("src/components/aibi/aibi-page-client.tsx");
  for (const key of ['t("name")', 't("rarity")', 't("element")', 't("habitat")', 't("cert")', 't("statusLabel")']) {
    assert.ok(src.includes(key), `中栏字段 ${key}`);
  }
  assert.ok(src.includes("EXP_PER_LEVEL"), "经验条口径=每级 100（单一数据源）");
  assert.ok(src.includes("expPct"), "经验条百分比");
  assert.ok(src.includes("MeterBar"), "亲密度/精力成长条");
  assert.ok(src.includes('t("affinity")') && src.includes('t("energy")'), "亲密度/精力标签");
});

test("stage(9.3): 右栏链上面板（持有者/铸造/销毁/流转轨迹）+ 底部互动时间线", () => {
  const src = read("src/components/aibi/aibi-page-client.tsx");
  for (const key of ['t("owner")', 't("mintedAt")', 't("eventBurn")', 't("historyTitle")']) {
    assert.ok(src.includes(key), `右栏字段 ${key}`);
  }
  assert.ok(src.includes("detail.provenance"), "流转轨迹数据源");
  assert.ok(src.includes("timeline"), "互动时间线渲染");
  assert.ok(src.includes('t("interactEmpty")'), "时间线空态");
});

test("stage(9.4): 四动作直连 /api/interact（仅持有者渲染 + 精力门槛禁用 + 升级提示）", () => {
  const src = read("src/components/aibi/aibi-page-client.tsx");
  assert.ok(src.includes('"/api/interact"'), "POST /api/interact");
  assert.ok(src.includes("tokenId: detail.aibiTokenId"), "请求体 tokenId+action");
  for (const a of ['"feed"', '"train"', '"talk"', '"play"']) {
    assert.ok(src.includes(a), `动作 ${a}`);
  }
  assert.ok(src.includes("INTERACT_RULES"), "动作规则单一数据源（效果提示/精力门槛）");
  assert.ok(src.includes("detail.viewerIsOwner"), "持有者门控");
  assert.ok(src.includes("ownerOnlyHint"), "非持有者只读提示");
  assert.ok(src.includes("leveledUp"), "升级提示");
});

test("stage(9.5): readTokenDetail 扩展 interactions（aibi_growth_logs 最新 20 条）+ i18n 新键", () => {
  const svc = read("src/lib/aibi-service.ts");
  assert.ok(svc.includes("FROM aibi_growth_logs"), "互动记录查询");
  assert.ok(svc.includes("LIMIT 20"), "时间线上限 20 条");
  assert.ok(svc.includes("interactions"), "detail 带 interactions 字段");

  const zh = JSON.parse(read("messages/zh.json"));
  const tp = zh.aibi?.tokenPage ?? {};
  for (const k of ["name", "rarity", "growthTitle", "exp", "affinity", "energy", "interactTitle", "interactEmpty"]) {
    assert.ok(tp[k], `zh tokenPage.${k}`);
  }
  for (const s of ["minted", "pending", "burned", "revoked"]) {
    assert.ok(tp.statuses?.[s], `zh tokenPage.statuses.${s}`);
  }
  assert.ok(!("interactEntry" in tp), "旧「去背包互动」入口键已移除（舞台内联互动取代）");
});

