// 产品升级 Phase 4：积分充值入口强化 —— 契约测试
// 覆盖：
//  1) 首充倍率常量（FIRST_PURCHASE_BONUS_MULTIPLIER=2，展示/发放同源）；
//  2) GET /api/user/first-purchase/status 路由契约；
//  3) pay/notify 首充双倍 CTE（first_purchase 一人一次 + first_purchase_bonus 流水 + 可重入补发）；
//  4) PointsBalance / SiteHeader 集成（桌面+移动 2 处 + Host 挂载）；
//  5) PointsPackPicker / PointsInsufficientModal / FirstPurchaseModal 组件契约；
//  6) PointsRechargeHost 事件总线分派（未首充→首充版，已首充→常规版，未登录→登录页）；
//  7) 三处 402 触发点 dispatch（盲盒/结晶共鸣/积分兑换）；
//  8) /points 页首充 ×2 标签；
//  9) i18n pointsEntry 双语对齐（含占位符）；
// 10) 零 schema 变更红线（first_purchase 表为 v19 既有，无 DDL/SCHEMA_VERSION 变更）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import {
  FIRST_PURCHASE_BONUS_MULTIPLIER,
  POINTS_PACKS,
} from "../src/lib/points-recharge.ts";
import { POINTS_INSUFFICIENT_EVENT } from "../src/lib/points-entry.ts";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// === 1) 首充倍率常量 ===
test("points-entry(1): 首充倍率常量=2（展示与发放同源，服务端档位表裁定）", () => {
  assert.equal(FIRST_PURCHASE_BONUS_MULTIPLIER, 2);
  const lib = read("../src/lib/points-recharge.ts");
  assert.match(lib, /export const FIRST_PURCHASE_BONUS_MULTIPLIER = 2;/);
  // bonus = pack.points × (multiplier − 1) = 等额
  assert.ok(POINTS_PACKS.every((p) => p.points * (FIRST_PURCHASE_BONUS_MULTIPLIER - 1) === p.points));
});

// === 2) status API 契约 ===
test("points-entry(2): first-purchase/status 路由——鉴权 + 查表 + 响应字段", () => {
  const src = read("../src/app/api/user/first-purchase/status/route.ts");
  assert.match(src, /export const runtime = "nodejs"/);
  assert.match(src, /getUserFromRequest/);
  assert.match(src, /status: 401/);
  assert.match(src, /FROM first_purchase/);
  assert.match(src, /WHERE user_id = \$1::uuid/);
  assert.match(src, /isFirstPurchase: !row/);
  assert.match(src, /bonusMultiplier: FIRST_PURCHASE_BONUS_MULTIPLIER/);
  assert.match(src, /purchasedAt/);
  assert.match(src, /bonusPoints/);
});

// === 3) notify 首充双倍 CTE ===
test("points-entry(3): pay/notify 首充双倍——一人一次 + 双倍入账 + ref 幂等", () => {
  const src = read("../src/app/api/pay/notify/route.ts");
  // first_purchase 写入（user_id 主键 ON CONFLICT 一人终身一次）
  assert.match(src, /INSERT INTO first_purchase \(user_id, package_type, points_received, bonus_points\)/);
  assert.match(src, /ON CONFLICT \(user_id\) DO NOTHING/);
  // bonus 流水：reason + ref 唯一兜底
  assert.match(src, /'first_purchase_bonus'/);
  assert.match(src, /`first-purchase:\$\{order_id\}`/);
  // bonus 金额 = pack.points（双倍=等额赠送）
  assert.match(src, /`points-\$\{pack\.points\}`/);
  assert.match(src, /first-purchase bonus credited/);
});

test("points-entry(4): 首充 bonus 可重入补发——paid 子查询独立于主入账 rowCount", () => {
  const src = read("../src/app/api/pay/notify/route.ts");
  // paid 子查询：本单确已入账即触发（首回调崩在 bonus 前 → 重试时主 CTE no-op 仍可补发）
  assert.match(src, /WITH paid AS \(\s*SELECT 1 FROM points_log WHERE ref = \$3 AND reason = 'recharge'\s*\)/);
  // bonus SQL 不引用主 CTE 的 rowCount（独立性：切片止于 bonus UPDATE 语句前，纯 SQL 段）
  const bonusBlock = src.slice(src.indexOf("WITH paid AS"), src.indexOf("UPDATE users SET points = points + $4"));
  assert.ok(!/rowCount/.test(bonusBlock), "bonus SQL 不得依赖主入账 rowCount");
  // bonus 入账 users.points += $4（= pack.points）
  assert.match(src, /UPDATE users SET points = points \+ \$4\s+WHERE id = \$1::uuid AND EXISTS \(SELECT 1 FROM bonus\)/);
});

// === 4) PointsBalance + SiteHeader 集成 ===
test("points-entry(5): PointsBalance 徽章组件（testid + /points 链接）", () => {
  const src = read("../src/components/PointsBalance.tsx");
  assert.match(src, /data-testid="points-balance"/);
  assert.match(src, /href="\/points"/);
  assert.match(src, /⭐ \{points\}/);
});

test("points-entry(6): SiteHeader 集成——桌面+移动双徽章 + Host 挂载 + 到账回写", () => {
  const src = read("../src/components/layout/SiteHeader.tsx");
  assert.match(src, /import \{ PointsBalance \} from "@\/components\/PointsBalance"/);
  assert.match(src, /import \{ PointsRechargeHost \} from "@\/components\/points-recharge-host"/);
  // 桌面单行 + 移动多行 JSX（标签后空格或换行皆匹配）
  const badges = src.match(/<PointsBalance[\s]/g) ?? [];
  assert.equal(badges.length, 2, "桌面+移动 2 处积分徽章");
  assert.match(src, /<PointsRechargeHost onPointsChanged=\{handlePointsChanged\} \/>/);
  // 到账回写 setMe（header 余额实时更新，无需路由跳转）
  assert.match(src, /handlePointsChanged = useCallback\(\(p: number\) => \{\s*setMe/);
});

// === 5) 三组件契约 ===
test("points-entry(7): PointsPackPicker——档位网格 + 首充 ×2 划线显示", () => {
  const src = read("../src/components/points-pack-picker.tsx");
  assert.match(src, /POINTS_PACKS\.map/);
  assert.match(src, /FIRST_PURCHASE_BONUS_MULTIPLIER/);
  assert.match(src, /`\$\{idPrefix\}-\$\{p\.points\}`/);
  assert.match(src, /`\$\{idPrefix\}-first-badge`/);
  assert.match(src, /line-through/);
  assert.match(src, /showRecommended/);
});

test("points-entry(8): PointsInsufficientModal——差额提示 + 内嵌充值链路", () => {
  const src = read("../src/components/points-insufficient-modal.tsx");
  assert.match(src, /data-testid="points-insufficient-modal"/);
  assert.match(src, /t\("insufficientNeeded", \{ needed \}\)/);
  assert.match(src, /<PointsPackPicker/);
  assert.match(src, /idPrefix="insufficient-pack"/);
  // 内嵌扫码充值（复用 /points 同链路）
  assert.match(src, /<PointsRechargeModal/);
  assert.match(src, /baselinePoints=\{baselinePoints\}/);
});

test("points-entry(9): FirstPurchaseModal——双倍横幅 + 推荐角标 + 内嵌充值链路", () => {
  const src = read("../src/components/first-purchase-modal.tsx");
  assert.match(src, /data-testid="first-purchase-modal"/);
  assert.match(src, /t\("firstTitle"\)/);
  assert.match(src, /t\("firstSubtitle", \{ multiplier: FIRST_PURCHASE_BONUS_MULTIPLIER \}\)/);
  assert.match(src, /t\("firstNote"\)/);
  assert.match(src, /idPrefix="first-pack"/);
  assert.match(src, /showRecommended/);
  assert.match(src, /<PointsRechargeModal/);
});

// === 6) Host 事件总线 ===
test("points-entry(10): 事件总线 + Host 分派（未首充→首充版 / 已首充→常规版 / 未登录→登录页）", () => {
  assert.equal(POINTS_INSUFFICIENT_EVENT, "aiabw:points-insufficient");
  const entry = read("../src/lib/points-entry.ts");
  assert.match(entry, /window\.dispatchEvent\(new CustomEvent\(POINTS_INSUFFICIENT_EVENT/);
  assert.match(entry, /typeof window === "undefined"/); // SSR 安全
  const host = read("../src/components/points-recharge-host.tsx");
  assert.match(host, /window\.addEventListener\(POINTS_INSUFFICIENT_EVENT, handler\)/);
  assert.match(host, /removeEventListener/);
  assert.match(host, /\/api\/user\/first-purchase\/status/);
  assert.match(host, /\/api\/auth\/me/); // 余额基线（到账判定）
  assert.match(host, /session\.isFirstPurchase \? \(\s*<FirstPurchaseModal/);
  assert.match(host, /<PointsInsufficientModal/);
  assert.match(host, /\/login\?redirect=/); // 未登录 → 登录页回跳
  // 状态拉取失败保守不标双倍（防误导承诺）
  assert.match(host, /保守：状态未知时不出双倍标签/);
});

// === 7) 三触发点 ===
test("points-entry(11): 402 触发点 dispatch（盲盒 / 结晶共鸣 / 积分兑换）", () => {
  const plaza = read("../src/components/blindbox-plaza.tsx");
  assert.match(plaza, /import \{ notifyPointsInsufficient \} from "@\/lib\/points-entry"/);
  assert.match(plaza, /res\.status === 402[\s\S]{0,200}notifyPointsInsufficient\(\{ needed: pool\.pricePoints \}\)/);
  const breed = read("../src/components/collection/nfr-breed-modal.tsx");
  assert.match(breed, /import \{ notifyPointsInsufficient \} from "@\/lib\/points-entry"/);
  assert.match(breed, /res\.status === 402[\s\S]{0,200}notifyPointsInsufficient\(\{ needed: BREED_COST_POINTS \}\)/);
  const page = read("../src/app/[locale]/points/page.tsx");
  assert.match(page, /import \{ notifyPointsInsufficient \} from "@\/lib\/points-entry"/);
  assert.match(page, /res\.status === 400 && points < REDEEM_PRICE[\s\S]{0,200}notifyPointsInsufficient\(\{ needed: REDEEM_PRICE \}\)/);
});

// === 8) /points 首充标签 ===
test("points-entry(12): /points 页首充 ×2 标签（状态拉取 + 角标 + 划线原价）", () => {
  const page = read("../src/app/[locale]/points/page.tsx");
  assert.match(page, /\/api\/user\/first-purchase\/status/);
  assert.match(page, /data-testid="points-pack-first-badge"/);
  assert.match(page, /p\.points \* FIRST_PURCHASE_BONUS_MULTIPLIER/);
  assert.match(page, /line-through/);
  assert.match(page, /useTranslations\("pointsEntry"\)/);
});

// === 9) i18n 对齐 ===
test("points-entry(13): i18n pointsEntry 双语 key parity + 占位符对齐", () => {
  const zh = JSON.parse(read("../messages/zh.json")).pointsEntry;
  const en = JSON.parse(read("../messages/en.json")).pointsEntry;
  assert.ok(zh && en, "pointsEntry 命名空间双语存在");
  const zhKeys = Object.keys(zh).sort();
  assert.deepEqual(Object.keys(en).sort(), zhKeys, "双语 key parity");
  for (const k of zhKeys) {
    const ph = (s) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    assert.deepEqual(ph(en[k]), ph(zh[k]), `${k} 占位符对齐`);
  }
  assert.match(zh.insufficientNeeded, /\{needed\}/);
  assert.match(zh.firstSubtitle, /\{multiplier\}/);
});

// === 10) 零 schema 变更红线 ===
test("points-entry(14): 零 schema 变更——first_purchase 为 v19 既有表，无 DDL/VERSION 改动", () => {
  const client = read("../src/db/client.ts");
  assert.match(client, /const SCHEMA_VERSION = 20;/, "SCHEMA_VERSION 本 Phase 无变更（20 由 Phase 8 提升）");
  // first_purchase DDL 仍是 v19 既有定义（本 Phase 只读应用层，不新增/改列）
  assert.match(client, /CREATE TABLE IF NOT EXISTS "first_purchase"/);
  const migrations = readdirSync(new URL("../drizzle", import.meta.url));
  // 注：0027_aibi_phase4_columns.sql 为 aibi 平台历史迁移，与本 Phase 无关，勿误伤
  assert.ok(!migrations.some((f) => /003[6-9]|points_entry/.test(f)), "无新增迁移文件（0035 属 Phase 8）");
});

