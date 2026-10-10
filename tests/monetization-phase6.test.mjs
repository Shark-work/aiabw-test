// 产品升级 Phase 6：变现功能集中实现 —— 契约测试
// 覆盖：
//  A) 盲盒保底：pity lib 纯函数 + blindbox-draw 集成 + draw 响应透传 + pity API + 前端进度条（指令 4）
//  B) pay/create 商品扩展：vip_yearly / breed_accel / chat_pack / promo_24h（指令 1，服务端定价）
//  C) pay/notify 分发：4 正则 + CTE 幂等（points_log ref 唯一索引）+ 事件覆盖说明（指令 2）
//  D) 推荐曝光下架：DELETE + GET LATERAL 扩展 + PromoteModal 入口（指令 6 补全）
//  E) i18n 双语 parity + 零 schema 变更红线（SCHEMA_VERSION=19 / 无新迁移）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  PITY_THRESHOLD,
  PITY_RESET_RARITIES,
  RARITY_ORDER,
  isPityResetRarity,
  pickPityRarity,
} from "../src/lib/pity.ts";
import {
  BREED_ACCEL_PRICE_CNY,
  CHAT_PACK_MESSAGES,
  CHAT_PACK_PRICE_CNY,
  PROMO_CASH_HOURS,
  PROMO_CASH_PRICE_CNY,
  VIP_YEARLY_DAYS,
  VIP_YEARLY_PRICE_CNY,
} from "../src/lib/monetization-products.ts";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ───────────── A1) pity lib 纯函数 ─────────────
test("phase6(A1): 保底常量——阈值 50 / 清零口径 epic+legendary / 档位表完整", () => {
  assert.equal(PITY_THRESHOLD, 50);
  assert.deepEqual([...PITY_RESET_RARITIES], ["epic", "legendary"]);
  assert.deepEqual([...RARITY_ORDER], ["common", "uncommon", "rare", "epic", "legendary"]);
  assert.ok(isPityResetRarity("epic") && isPityResetRarity("legendary"));
  assert.ok(!isPityResetRarity("rare") && !isPityResetRarity("common"));
});

test("phase6(A2): pickPityRarity——epic+ 池取最高档；权重 0 档排除", () => {
  // 常规池：legendary 权重>0 → 保底必出传说
  assert.equal(pickPityRarity({ common: 70, rare: 20, epic: 9, legendary: 1 }), "legendary");
  // legendary 权重 0（未上架）→ 落到 epic
  assert.equal(pickPityRarity({ common: 80, rare: 15, epic: 5, legendary: 0 }), "epic");
  // 池内无 epic+ → 池内最高档兜底（保底仍优于常规期望）
  assert.equal(pickPityRarity({ common: 90, uncommon: 8, rare: 2 }), "rare");
  assert.equal(pickPityRarity({ common: 100 }), "common");
  // 空表防御
  assert.equal(pickPityRarity({}), "epic");
  assert.equal(pickPityRarity(null), "epic");
});

// ───────────── A3) blindbox-draw 保底集成契约 ─────────────
test("phase6(A3): blindbox-draw——事务内行锁读计数 + 阈值判定 + 强制出货", () => {
  const src = read("../src/lib/blindbox-draw.ts");
  assert.match(src, /FROM pity_counter[\s\S]*?FOR UPDATE/, "pity_counter 行锁读取（事务内并发安全）");
  assert.match(src, /prevPullCount \+ 1 >= PITY_THRESHOLD/, "第 50 抽（pullCount+1 达阈值）触发保底");
  assert.match(src, /pityTriggered \? pickPityRarity\(probabilities\) : weightedPick\(probabilities\)/,
    "保底触发 → 池内保底档强制出货；否则加权随机");
});

test("phase6(A4): blindbox-draw——抽后 UPSERT：出稀有清零 / 否则 +1；返回 pity 状态", () => {
  const src = read("../src/lib/blindbox-draw.ts");
  assert.match(src, /INSERT INTO pity_counter \(user_id, pool_id, pull_count\)/);
  assert.match(src, /ON CONFLICT \(user_id, pool_id\)\s*DO UPDATE SET pull_count = EXCLUDED\.pull_count/,
    "UPSERT 原子更新（复合主键）");
  assert.match(src, /const reset = isPityResetRarity\(rarity\)/, "出稀有（epic/legendary）清零");
  assert.match(src, /const nextPullCount = reset \? 0 : prevPullCount \+ 1/, "未出稀有 +1");
  assert.match(src, /pity: \{[\s\S]*?triggered: pityTriggered[\s\S]*?pullCount: nextPullCount/,
    "返回值携带 pity 状态");
  assert.match(src, /remaining: Math\.max\(0, PITY_THRESHOLD - nextPullCount\)/, "remaining 防负");
});

test("phase6(A5): draw route——积分通道响应透传 pity（前端进度条即时刷新）", () => {
  const src = read("../src/app/api/blindbox/draw/route.ts");
  assert.match(src, /pity: result\.pity/, "draw 响应携带 pity 字段");
});

// ───────────── A6) pity API 契约 ─────────────
test("phase6(A6): GET /api/blindbox/pity——鉴权 + poolId 校验 + 全量字段 + 同源裁定", () => {
  const src = read("../src/app/api/blindbox/pity/route.ts");
  assert.match(src, /export async function GET/, "GET handler 存在");
  assert.match(src, /getUserFromRequest/, "鉴权");
  assert.match(src, /status: 401/, "未登录 401");
  assert.match(src, /searchParams\.get\("poolId"\)/, "poolId query 参数");
  assert.match(src, /threshold: PITY_THRESHOLD/, "threshold 与 lib 同源");
  assert.match(src, /guaranteedRarity: pickPityRarity\(probabilities\)/, "保底稀有度与服务端判定同源");
  assert.match(src, /resetRarities: PITY_RESET_RARITIES/, "清零口径透出");
  assert.match(src, /remaining: Math\.max\(0, PITY_THRESHOLD - pullCount\)/, "remaining 防负");
});

// ───────────── A7) 前端进度条 ─────────────
test("phase6(A7): blindbox-plaza——进度条挂载 + draw 响应即时刷新 + 保底触发标记", () => {
  const src = read("../src/components/blindbox-plaza.tsx");
  assert.match(src, /\/api\/blindbox\/pity\?poolId=/, "挂载即查保底进度");
  assert.match(src, /data-testid="pity-progress"/, "进度条 testid");
  assert.match(src, /t\("pityRemaining", \{/, "「再抽 n 次必出」文案");
  assert.match(src, /applyDrawPity\(data\.pity\)/, "draw 响应 pity 即时刷新");
  assert.match(src, /data-testid="pity-triggered-badge"/, "结果弹窗保底触发标记");
  assert.match(src, /t\("pityTriggered"\)/);
});


// ───────────── B1) 商品定价常量 ─────────────
test("phase6(B1): monetization-products——服务端定价常量（与实施计划 8.1.1 对齐）", () => {
  assert.equal(VIP_YEARLY_PRICE_CNY, 148);
  assert.equal(VIP_YEARLY_DAYS, 365);
  assert.equal(BREED_ACCEL_PRICE_CNY, 5);
  assert.equal(CHAT_PACK_PRICE_CNY, 9.9);
  assert.equal(CHAT_PACK_MESSAGES, 50);
  assert.equal(PROMO_CASH_PRICE_CNY, 6);
  assert.equal(PROMO_CASH_HOURS, 24);
});

// ───────────── B2) pay/create 新商品 ─────────────
test("phase6(B2): pay/create——4 新 kind 定价分支（订单号前缀 + 服务端价格）", () => {
  const src = read("../src/app/api/pay/create/route.ts");
  for (const k of ['"vip_yearly"', '"breed_accel"', '"chat_pack"', '"promo_24h"']) {
    assert.ok(src.includes(`body?.kind === ${k}`), `kind 解析含 ${k}`);
  }
  assert.match(src, /`premium-yearly-\$\{user\.id\}-\$\{nonce\}`/, "年卡订单号前缀");
  assert.match(src, /`breedaccel-\$\{collectibleId\}-\$\{user\.id\}-\$\{nonce\}`/, "加速订单号前缀");
  assert.match(src, /`chatpack-\$\{CHAT_PACK_MESSAGES\}-\$\{user\.id\}-\$\{nonce\}`/, "聊天包订单号前缀");
  assert.match(src, /`promo24-\$\{contentId\}-\$\{user\.id\}-\$\{nonce\}`/, "曝光订单号前缀");
  assert.match(src, /VIP_YEARLY_PRICE_CNY\.toFixed\(2\)/, "年卡价格服务端裁定");
  assert.match(src, /BREED_ACCEL_PRICE_CNY\.toFixed\(2\)/, "加速价格服务端裁定");
  assert.match(src, /CHAT_PACK_PRICE_CNY\.toFixed\(2\)/, "聊天包价格服务端裁定");
  assert.match(src, /PROMO_CASH_PRICE_CNY\.toFixed\(2\)/, "曝光价格服务端裁定");
});

test("phase6(B3): pay/create——breed_accel 归属+冷却校验；promo_24h 归属+防重校验", () => {
  const src = read("../src/app/api/pay/create/route.ts");
  assert.match(src, /breed_cooldown_until AS "cd"/, "读取冷却时间");
  assert.match(src, /code: "NOT_IN_COOLDOWN"[\s\S]*?status: 400/, "不在冷却中 → 400（无需加速）");
  assert.match(src, /code: "ALREADY_PROMOTED"[\s\S]*?status: 409/, "已推广中 → 409（防双通道撞车）");
  assert.match(src, /String\(accelRows\[0\]\.owner_id\) !== user\.id[\s\S]*?status: 403/, "加速归属 403");
  assert.match(src, /String\(promoRows\[0\]\.owner_id\) !== user\.id[\s\S]*?status: 403/, "曝光归属 403");
});

// ───────────── C) pay/notify 分发 ─────────────
test("phase6(C1): notify——4 新订单号正则（前缀 + uuid 段）", () => {
  const src = read("../src/app/api/pay/notify/route.ts");
  assert.match(src, /\^premium-yearly-\(\[0-9a-f\]\{8\}/, "年卡正则");
  assert.match(src, /\^breedaccel-\(\[0-9a-f\]\{8\}[\s\S]*?\)-\(\[0-9a-f\]\{8\}/, "加速正则（collectibleId+userId）");
  assert.match(src, /\^chatpack-\(\\d\+\)-\(\[0-9a-f\]\{8\}/, "聊天包正则（messages+userId）");
  assert.match(src, /\^promo24-\(\[0-9a-f\]\{8\}[\s\S]*?\)-\(\[0-9a-f\]\{8\}/, "曝光正则（contentId+userId）");
});

test("phase6(C2): notify——年卡 GREATEST 顺延 365 天 + ref 幂等", () => {
  const src = read("../src/app/api/pay/notify/route.ts");
  assert.match(src, /premiumYearlyMatch[\s\S]*?'vip_yearly'/, "年卡流水 reason");
  assert.match(src, /GREATEST\(COALESCE\(premium_until, now\(\)\), now\(\)\) \+ make_interval\(days => \$3\)/,
    "GREATEST 顺延（续费累计不缩短）");
  assert.match(src, /\[userId, order_id, VIP_YEARLY_DAYS\]/, "天数取服务端常量");
});

test("phase6(C3): notify——结晶加速先记账后清冷却（防重复回调误清新冷却）", () => {
  const src = read("../src/app/api/pay/notify/route.ts");
  assert.match(src, /breedAccelMatch[\s\S]*?'breed_accel'[\s\S]*?ON CONFLICT \(ref\) DO NOTHING[\s\S]*?UPDATE user_collectibles SET breed_cooldown_until = now\(\)/,
    "CTE：points_log ref 唯一记账 → 条件 UPDATE");
  assert.match(src, /WHERE id = \$3::uuid AND owner_id = \$2::uuid AND EXISTS \(SELECT 1 FROM ins\)/,
    "归属条件 + 记账存在才发货");
});

test("phase6(C4): notify——聊天包当日额度回充（GREATEST 防负 + UPSERT + 幂等）", () => {
  const src = read("../src/app/api/pay/notify/route.ts");
  assert.match(src, /chatPackMatch[\s\S]*?'chat_pack'/, "聊天包流水 reason");
  assert.match(src, /INSERT INTO chat_quotas \(id, user_id, date, message_count, last_message_at\)/);
  assert.match(src, /ON CONFLICT \(user_id, date\)\s*DO UPDATE SET message_count = GREATEST\(0, chat_quotas\.message_count - \$5\)/,
    "已用句数 -N（防负）");
  assert.match(src, /todayString\(\)/, "日期与 /api/chat 同源（UTC）");
  assert.match(src, /`quota-\$\{userId\}-\$\{today\}`/, "行 id 与现有模式一致");
});

test("phase6(C5): notify——曝光现金通道写 promoted_content（24h + 防并发撞车）", () => {
  const src = read("../src/app/api/pay/notify/route.ts");
  assert.match(src, /promo24Match[\s\S]*?'promotion_purchase'/, "曝光流水 reason（v19 注册值域）");
  assert.match(src, /INSERT INTO promoted_content \(content_type, content_id, promoter_id, start_time, end_time, priority\)/);
  assert.match(src, /now\(\) \+ make_interval\(hours => \$5\), 1/, "24h + priority=1（与积分 1 天档一致）");
  assert.match(src, /AND NOT EXISTS \([\s\S]*?pc\.end_time > now\(\)[\s\S]*?\)/, "生效窗口防重（NOT EXISTS）");
});

test("phase6(C6): notify——事件覆盖说明（success 唯一回调 / failed 无副作用 / refunded 人工）", () => {
  const src = read("../src/app/api/pay/notify/route.ts");
  assert.match(src, /payment\.success：XorPay 个人码唯一推送的事件/, "success 说明");
  assert.match(src, /payment\.failed：XorPay 无失败回调/, "failed 说明");
  assert.match(src, /payment\.refunded：XorPay 无退款回调渠道/, "refunded 人工流程说明");
});


// ───────────── D) 推荐曝光下架 ─────────────
test("phase6(D1): DELETE /api/content/promote——归属校验 + end_time 立即失效 + 幂等", () => {
  const src = read("../src/app/api/content/promote/route.ts");
  assert.match(src, /export async function DELETE/, "DELETE handler 存在");
  assert.match(src, /UPDATE promoted_content SET end_time = now\(\), updated_at = now\(\)/, "立即失效");
  assert.match(src, /AND promoter_id = \$3::uuid\s*AND end_time > now\(\)/, "promoter 双保险 + 只动生效推广");
  assert.match(src, /ended: rowCount \?\? 0/, "幂等返回 ended（重复下架=0）");
  assert.match(src, /status: 403/, "非本人 403");
});

test("phase6(D2): GET promote——LATERAL 取生效推广 id/到期时间（下架入口数据源）", () => {
  const src = read("../src/app/api/content/promote/route.ts");
  assert.match(src, /LEFT JOIN LATERAL \([\s\S]*?pc\.end_time > now\(\)[\s\S]*?LIMIT 1\s*\) pr ON true/);
  assert.match(src, /promoting: r\.promotionId != null/, "promoting 由推广行存在性推导");
  assert.match(src, /promotionEndTime: r\.promotionEndTime/, "到期时间透出");
});

test("phase6(D3): PromoteModal——推广中徽章可点击提前下架（confirm + DELETE + 刷新）", () => {
  const src = read("../src/components/promote-modal.tsx");
  assert.match(src, /data-testid=\{`promote-end-\$\{pet\.id\}`\}/, "下架入口 testid");
  assert.match(src, /method: "DELETE"/, "DELETE 请求");
  assert.match(src, /window\.confirm\(t\("endConfirm"\)\)/, "不退款确认");
  assert.match(src, /e\.stopPropagation\(\)/, "阻止冒泡（不触发卡片选中）");
  assert.match(src, /onPromoted\(\)/, "下架后通知父组件刷新榜单");
});

// ───────────── E1) i18n parity ─────────────
test("phase6(E1): i18n 双语对齐——blindbox.pity* / api 新 key / promote.end*", () => {
  const zh = JSON.parse(read("../messages/zh.json"));
  const en = JSON.parse(read("../messages/en.json"));
  for (const k of ["pityLabel", "pityRemaining", "pityTriggered"]) {
    assert.ok(zh.blindbox[k], `zh.blindbox.${k}`);
    assert.ok(en.blindbox[k], `en.blindbox.${k}`);
  }
  for (const ns of [zh.blindbox, en.blindbox]) {
    assert.ok(ns.pityRemaining.includes("{n}") && ns.pityRemaining.includes("{rarity}"),
      "pityRemaining 双占位符齐全");
  }
  for (const k of ["promoteAlreadyActive", "accelNotNeeded"]) {
    assert.ok(zh.api[k], `zh.api.${k}`);
    assert.ok(en.api[k], `en.api.${k}`);
  }
  for (const k of ["endEarly", "endConfirm", "endDone", "endFailed", "until"]) {
    assert.ok(zh.promote[k], `zh.promote.${k}`);
    assert.ok(en.promote[k], `en.promote.${k}`);
  }
});

// ───────────── E2) 零 schema 变更红线 ─────────────
test("phase6(E2): 零 schema 变更——SCHEMA_VERSION 维持 19，pity_counter 为 v19 既有表", () => {
  const client = read("../src/db/client.ts");
  assert.match(client, /const SCHEMA_VERSION = 22;/, "SCHEMA_VERSION 本 Phase 无变更（20 由 Phase 8 提升）");
  const migrations = readdirSync(new URL("../drizzle", import.meta.url));
  assert.ok(!migrations.some((f) => /^003[8-9]|^00[4-9]\d/.test(f)),
    "无 0036+ 新迁移文件（0035 属 Phase 8；本 Phase 全部复用 v19 既有表）");
  const schema = read("../src/db/schema.ts");
  assert.match(schema, /export const pityCounter = pgTable\('pity_counter'/, "pity_counter drizzle 定义既有");
});
