// 宠物旅行日记 · VIP 订阅系统单测
// 覆盖：QUOTA_CONFIG 阈值、getQuotaStatus/getRemaining 分支、
//      quota-messages 文案（按宠物 × 语言）、subscription 元信息（features/planIds）、
//      daysUntilExpiry、SQL 迁移与种子幂等性、schema.ts 导出
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  QUOTA_CONFIG,
  getQuotaStatus,
  getRemaining,
  todayString,
} from "../src/lib/chat-quota-config.ts";
import {
  getHardLimitMessage,
  getSoftWarnMessage,
} from "../src/lib/quota-messages.ts";
import {
  SUBSCRIPTION_FEATURES,
  SUBSCRIPTION_PLAN_IDS,
  daysUntilExpiry,
} from "../src/lib/subscription-config.ts";

const ROOT = join(import.meta.dirname ?? __dirname, "..");

// ───────────── 1) 额度阈值常量 ─────────────
test("quota: FREE_DAILY_LIMIT = 10, VIP_DAILY_LIMIT = -1, SOFT_WARN_AT = 0.8", () => {
  assert.equal(QUOTA_CONFIG.FREE_DAILY_LIMIT, 10);
  assert.equal(QUOTA_CONFIG.VIP_DAILY_LIMIT, -1);
  assert.equal(QUOTA_CONFIG.SOFT_WARN_AT, 0.8);
  assert.equal(QUOTA_CONFIG.GUEST_DAILY_LIMIT, 5);
});

// ───────────── 2) getQuotaStatus 4 个分支 ─────────────
test("quota status: count=0 free => normal", () => {
  assert.equal(getQuotaStatus(0, false), "normal");
});
test("quota status: count=7 free => normal (still under 80%)", () => {
  assert.equal(getQuotaStatus(7, false), "normal");
});
test("quota status: count=8 free => soft_warn (>=80% of 10)", () => {
  assert.equal(getQuotaStatus(8, false), "soft_warn");
});
test("quota status: count=9 free => soft_warn", () => {
  assert.equal(getQuotaStatus(9, false), "soft_warn");
});
test("quota status: count=10 free => hard_limit (>= FREE_DAILY_LIMIT)", () => {
  assert.equal(getQuotaStatus(10, false), "hard_limit");
});
test("quota status: count=999 free => hard_limit (capped)", () => {
  assert.equal(getQuotaStatus(999, false), "hard_limit");
});
test("quota status: VIP 永远 vip (any count)", () => {
  assert.equal(getQuotaStatus(0, true), "vip");
  assert.equal(getQuotaStatus(10, true), "vip");
  assert.equal(getQuotaStatus(100, true), "vip");
});

// ───────────── 3) getRemaining ─────────────
test("quota remaining: free user 10-3=7", () => {
  assert.equal(getRemaining(3, false), 7);
});
test("quota remaining: free user 10-10=0 (floor)", () => {
  assert.equal(getRemaining(10, false), 0);
});
test("quota remaining: free user count > limit stays 0 (never negative)", () => {
  assert.equal(getRemaining(99, false), 0);
});
test("quota remaining: VIP => -1 (unlimited)", () => {
  assert.equal(getRemaining(0, true), -1);
  assert.equal(getRemaining(99, true), -1);
});

// ───────────── 4) todayString 格式 ─────────────
// ───────────── 5) quota-messages 文案覆盖 ─────────────
const PET_KINDS = ["cat", "dog", "fox", "rabbit"];
const LOCALES = ["zh", "en"];

test("quota messages: hard limit text per kind × locale (non-empty, no {remaining})", () => {
  for (const k of PET_KINDS) {
    for (const loc of LOCALES) {
      const m = getHardLimitMessage(k, loc);
      assert.ok(typeof m === "string" && m.length > 5, `${k}/${loc} too short: ${m}`);
      assert.ok(!m.includes("{remaining}"), "hard limit should not have placeholder");
      const lower = m.toLowerCase();
      if (loc === "en") {
        assert.ok(lower.includes("vip"), `${k}/${loc} missing 'vip': ${m}`);
      } else {
        assert.ok(m.includes("VIP") || m.includes("vip"), `${k}/${loc} missing VIP: ${m}`);
      }
    }
  }
});

test("quota messages: soft warn has {remaining} placeholder replaced", () => {
  for (const k of PET_KINDS) {
    for (const loc of LOCALES) {
      const m = getSoftWarnMessage(k, loc, 3);
      assert.ok(!m.includes("{remaining}"), `${k}/${loc} still has placeholder: ${m}`);
      assert.ok(m.includes("3"), `${k}/${loc} does not contain 3: ${m}`);
    }
  }
});

test("quota messages: unknown kind falls back to fox", () => {
  const a = getHardLimitMessage("dragon", "zh");
  const b = getHardLimitMessage("fox", "zh");
  assert.equal(a, b);
  const c = getSoftWarnMessage(undefined, "en", 2);
  const d = getSoftWarnMessage("fox", "en", 2);
  assert.equal(c, d);
});

// ───────────── 6) subscription 元信息 ─────────────
test("subscription: 3 plan ids in fixed order", () => {
  assert.deepEqual([...SUBSCRIPTION_PLAN_IDS], ["monthly", "quarterly", "yearly"]);
});
test("subscription: features list non-empty and has unlimitedChat + memoryAccess", () => {
  assert.ok(SUBSCRIPTION_FEATURES.length > 0);
  assert.ok(SUBSCRIPTION_FEATURES.includes("unlimitedChat"));
  assert.ok(SUBSCRIPTION_FEATURES.includes("memoryAccess"));
});

// ───────────── 7) daysUntilExpiry ─────────────
test("daysUntilExpiry: future date positive", () => {
  const now = new Date("2026-09-08T00:00:00Z");
  const exp = new Date("2026-09-15T00:00:00Z");
  assert.equal(daysUntilExpiry(exp, now), 7);
});
test("daysUntilExpiry: same day later = 0 (floor)", () => {
  // now=05:00, exp=10:00 同一天：差 +5h = 0.208天 → floor = 0
  const now = new Date("2026-09-08T05:00:00Z");
  const exp = new Date("2026-09-08T10:00:00Z");
  assert.equal(daysUntilExpiry(exp, now), 0);
});
test("daysUntilExpiry: past date <= 0 (floor)", () => {
  const now = new Date("2026-09-08T00:00:00Z");
  const exp = new Date("2026-09-01T00:00:00Z");
  const d = daysUntilExpiry(exp, now);
  assert.ok(d <= 0, `expected <=0, got ${d}`);
});

// ───────────── 8) SQL 迁移文件存在性 + 内容检查 ─────────────
test("drizzle/0018_subscription.sql exists and creates 3 tables", () => {
  const p = join(ROOT, "drizzle", "0018_subscription.sql");
  assert.ok(existsSync(p), `missing: ${p}`);
  const sql = readFileSync(p, "utf8");
  assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS \"chat_quotas\""));
  assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS \"subscription_plans\""));
  assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS \"user_subscriptions\""));
  assert.ok(sql.includes("'monthly'"), "monthly plan");
  assert.ok(sql.includes("'quarterly'"), "quarterly plan");
  assert.ok(sql.includes("'yearly'"), "yearly plan");
  assert.ok(sql.includes("1990"), "monthly 19.9 yuan");
  assert.ok(sql.includes("4990"), "quarterly 49.9 yuan");
  assert.ok(sql.includes("12800"), "yearly 128 yuan");
  assert.ok(sql.includes("idx_chat_quotas_user_date"));
  assert.ok(sql.includes("idx_user_subscriptions_user"));
  assert.ok(sql.includes("ON CONFLICT"), "ON CONFLICT for idempotency");
});

// ───────────── 9) db/client.ts 已注入 3 个新 DDL + 索引 ─────────────
test("db/client.ts: includes chat_quotas / subscription_plans / user_subscriptions DDL + indexes", () => {
  const p = join(ROOT, "src", "db", "client.ts");
  const ts = readFileSync(p, "utf8");
  assert.ok(ts.includes("CREATE TABLE IF NOT EXISTS \"chat_quotas\""));
  assert.ok(ts.includes("CREATE TABLE IF NOT EXISTS \"subscription_plans\""));
  assert.ok(ts.includes("CREATE TABLE IF NOT EXISTS \"user_subscriptions\""));
  assert.ok(ts.includes("idx_chat_quotas_user_date"));
  assert.ok(ts.includes("idx_user_subscriptions_user"));
});

// ───────────── 10) schema.ts 导出 3 个新表 ─────────────
test("db/schema.ts: exports chatQuotas / subscriptionPlans / userSubscriptions", () => {
  const p = join(ROOT, "src", "db", "schema.ts");
  const ts = readFileSync(p, "utf8");
  assert.ok(/export const chatQuotas\s*=\s*pgTable/.test(ts));
  assert.ok(/export const subscriptionPlans\s*=\s*pgTable/.test(ts));
  assert.ok(/export const userSubscriptions\s*=\s*pgTable/.test(ts));
});

// ───────────── 11) chat/route.ts 集成配额校验 ─────────────
test("chat/route.ts: 包含 quota_exceeded 429 + chat_quotas increment", () => {
  const p = join(ROOT, "src", "app", "api", "chat", "route.ts");
  const ts = readFileSync(p, "utf8");
  assert.ok(ts.includes("quota_exceeded"), "must return code quota_exceeded");
  assert.ok(ts.includes("status: 429") || ts.includes("status:429"), "HTTP 429");
  assert.ok(ts.includes("getHardLimitMessage"), "uses hard limit message helper");
  assert.ok(ts.includes("getSoftWarnMessage"), "uses soft warn message helper");
  assert.ok(ts.includes("chat_quotas"), "writes to chat_quotas");
});

// ───────────── 12) pay/notify 订阅分支 ─────────────
test("pay/notify/route.ts: 处理 subscription-<plan>-<user> 前缀", () => {
  const p = join(ROOT, "src", "app", "api", "pay", "notify", "route.ts");
  const ts = readFileSync(p, "utf8");
  assert.ok(ts.includes("subscription-"), "matches subscription- prefix");
  assert.ok(ts.includes("user_subscriptions"), "writes to user_subscriptions");
  assert.ok(/365|90/.test(ts), "has duration 365 or 90");
});

// ───────────── 13) 订阅 API 路由存在 + 主合约 ─────────────
test("subscription/plans: 路由存在 + 正确导出 GET", () => {
  const p = join(ROOT, "src", "app", "api", "subscription", "plans", "route.ts");
  assert.ok(existsSync(p));
  const ts = readFileSync(p, "utf8");
  assert.ok(/export async function GET/.test(ts));
  assert.ok(ts.includes("subscriptionPlans"));
});
test("subscription/create: 路由存在 + 校验 planId + 调 xorpay", () => {
  const p = join(ROOT, "src", "app", "api", "subscription", "create", "route.ts");
  assert.ok(existsSync(p));
  const ts = readFileSync(p, "utf8");
  assert.ok(/export async function POST/.test(ts));
  assert.ok(ts.includes("planId"));
  assert.ok(ts.includes("createXorpayOrder"));
});
test("subscription/status: 路由存在 + 返回 isVip", () => {
  const p = join(ROOT, "src", "app", "api", "subscription", "status", "route.ts");
  assert.ok(existsSync(p));
  const ts = readFileSync(p, "utf8");
  assert.ok(/export async function GET/.test(ts));
  assert.ok(ts.includes("isVip"));
});
test("subscription/cancel: 路由存在 + 关闭 auto_renew", () => {
  const p = join(ROOT, "src", "app", "api", "subscription", "cancel", "route.ts");
  assert.ok(existsSync(p));
  const ts = readFileSync(p, "utf8");
  assert.ok(/export async function POST/.test(ts));
  assert.ok(ts.includes("autoRenew"));
});

// ───────────── 14) 订阅页 + UI 组件存在 ─────────────
test("subscribe page + SubscribeClient + QuotaBadge exist", () => {
  assert.ok(existsSync(join(ROOT, "src/app/[locale]/subscribe/page.tsx")));
  assert.ok(existsSync(join(ROOT, "src/components/subscription/subscribe-client.tsx")));
  assert.ok(existsSync(join(ROOT, "src/components/chat/quota-ui.tsx")));
});

// ───────────── 15) i18n namespaces 完整 ─────────────
test("i18n: messages/zh.json + en.json 都有 subscription + quota namespace", () => {
  for (const loc of ["zh", "en"]) {
    const p = join(ROOT, "messages", `${loc}.json`);
    const j = JSON.parse(readFileSync(p, "utf8"));
    assert.ok(j.subscription, `${loc}.json missing subscription`);
    assert.ok(j.quota, `${loc}.json missing quota`);
    assert.ok(j.subscription.title, `${loc}.json subscription.title`);
    assert.ok(j.subscription.features.unlimitedChat, `${loc}.json features.unlimitedChat`);
    assert.ok(j.subscription.faq.q1, `${loc}.json faq.q1`);
    assert.ok(j.quota.upgrade, `${loc}.json quota.upgrade`);
    assert.ok(j.quota.hardLimit, `${loc}.json quota.hardLimit`);
  }
});
