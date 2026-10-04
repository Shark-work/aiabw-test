// 邀请返利 · 双方 3 天 VIP（P0 概念收敛 Commit 4，2026-10-14）契约测试：
//  1) grantVipDays：plan=trial3d + 确定性订阅 id + ON CONFLICT (id) DO NOTHING 幂等
//     + GREATEST(now(),现有最晚到期) 顺延（与 pay/notify 发放口径一致）；
//  2) releaseInviteReward：credited 事务内双发（inviter/invited 各 3 天），
//     不再发放积分（points_log reason='referral' 移除）；pending 面值 amount=VIP 天数；
//  3) trial3d 档位：client.ts 种子（is_active=false → /api/subscription/plans 不外露）
//     + drizzle/0030 档案 + SCHEMA_VERSION≥15；plans API 仅查 is_active=true；
//  4) GET /api/referral：inviteCode + stats(invited/rewarded 按 inviter 聚合) + vipDays；
//  5) 前端：companion-panel 消费 /api/referral（inviteCode+stats）+ inviteStats 双语；
//  6) i18n：myPets.inviteHint 含 VIP 规则、api.referralLoadFailed 双语、zh/en 对齐。
// 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/referral-vip.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { INVITE_REWARD_VIP_DAYS } from "../src/lib/referral.ts";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const exists = (rel) => existsSync(join(ROOT, rel));

// === 1) grantVipDays 幂等发放 ===
test("grantVipDays: trial3d + deterministic id + idempotent upsert + rollover", () => {
  const src = read("src/lib/referral-reward.ts");
  assert.ok(src.includes("export async function grantVipDays"), "exports grantVipDays");
  assert.ok(src.includes("'trial3d'"), "plan = trial3d");
  assert.ok(src.includes("ON CONFLICT (id) DO NOTHING"), "deterministic-id idempotency");
  assert.ok(src.includes("GREATEST(now(), COALESCE(("), "rollover from latest active expiry");
  assert.ok(src.includes("max(expires_at)"), "bases on latest active subscription");
  assert.ok(src.includes("user_subscriptions"), "writes user_subscriptions");
});

// === 2) releaseInviteReward 双发 VIP、不再发积分 ===
test("releaseInviteReward: both sides get VIP in one tx; no more points", () => {
  const src = read("src/lib/referral-reward.ts");
  assert.ok(src.includes("`referral-${row.id}-inviter`"), "inviter deterministic sub id");
  assert.ok(src.includes("`referral-${row.id}-invited`"), "invited deterministic sub id");
  assert.ok(src.includes("db.transaction"), "dual grant in one transaction");
  assert.ok(src.includes("vipDays: INVITE_REWARD_VIP_DAYS"), "returns vipDays");
  assert.ok(!src.includes("pointsLog"), "no more points_log referral credit");
  assert.ok(!src.includes("users.points} +"), "no more points increment");
  assert.ok(!read("src/lib/referral.ts").includes("INVITE_REWARD_POINTS"),
    "legacy points constant removed");
  assert.equal(INVITE_REWARD_VIP_DAYS, 3, "both sides get 3 days");
  // 冻结记录面值语义 = VIP 天数
  assert.ok(src.includes("amount: INVITE_REWARD_VIP_DAYS"), "pending amount = VIP days");
});

// === 3) trial3d 档位种子（隐藏档）+ 版本号 + 档案 ===
test("trial3d plan: seeded inactive; SCHEMA_VERSION >= 15; drizzle archive", () => {
  const client = read("src/db/client.ts");
  assert.ok(client.includes("'trial3d'"), "client.ts seeds trial3d");
  assert.ok(client.includes("ON CONFLICT (\"id\") DO NOTHING"), "seed idempotent");
  const seedLine = client.split("\n").find((l) => l.includes("'trial3d'"));
  assert.ok(seedLine.includes(",false)"), "is_active=false (hidden from purchase list)");
  assert.ok(seedLine.includes('"unlimitedChat"'), "full VIP feature set");
  const v = Number(client.match(/SCHEMA_VERSION\s*=\s*(\d+)/)?.[1]);
  assert.ok(v >= 15, `SCHEMA_VERSION >= 15 (actual ${v})`);
  const archive = read("drizzle/0030_referral_vip_trial.sql");
  assert.ok(archive.includes("'trial3d'"), "archive seeds trial3d");

// === 4) GET /api/referral 概览 ===
test("GET /api/referral: inviteCode + stats + vipDays", () => {
  assert.ok(exists("src/app/api/referral/route.ts"), "route exists");
  const src = read("src/app/api/referral/route.ts");
  assert.ok(src.includes("export async function GET"), "GET handler");
  assert.ok(src.includes("getUserFromRequest"), "auth required");
  assert.ok(src.includes("inviteCode: me?.inviteCode ?? null"), "returns inviteCode");
  assert.ok(src.includes("eq(inviteRewards.inviterId, user.id)"), "stats by inviter");
  assert.ok(src.includes("filter (where ${inviteRewards.status} = 'credited')"),
    "rewarded counts credited only");
  assert.ok(src.includes("vipDays: INVITE_REWARD_VIP_DAYS"), "returns reward rule");
});

// === 5) 前端入口 ===
test("companion-panel: consumes /api/referral with stats display", () => {
  const src = read("src/components/pets/companion-panel.tsx");
  assert.ok(src.includes('fetch("/api/referral"'), "fetches referral overview");
  assert.ok(src.includes("setInviteStats(data.stats)"), "stores stats");
  assert.ok(src.includes('t("inviteStats"'), "renders stats line");
  assert.ok(!src.includes('fetch("/api/auth/me", { headers: { Authorization'),
    "no longer uses /api/auth/me for invite");
});

// === 6) i18n 双语 ===
test("i18n: invite copy carries VIP rule; referralLoadFailed; zh/en aligned", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  assert.ok(zh.myPets.inviteHint.includes("3 天 VIP"), "zh hint states 3-day VIP both sides");
  assert.ok(en.myPets.inviteHint.includes("3 days of VIP"), "en hint states 3-day VIP");
  assert.ok(!zh.myPets.inviteHint.includes("50 积分"), "zh hint no longer mentions 50 points");
  assert.equal(typeof zh.myPets.inviteStats, "string");
  assert.equal(typeof en.myPets.inviteStats, "string");
  assert.equal(typeof zh.api.referralLoadFailed, "string");
  assert.equal(typeof en.api.referralLoadFailed, "string");
  const flatten = (obj, prefix = "") =>
    Object.entries(obj ?? {}).flatMap(([k, v]) =>
      v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );
  assert.deepEqual(flatten(zh.myPets).sort(), flatten(en.myPets).sort(),
    "myPets zh/en deep keys aligned");
});

  assert.ok(archive.includes("回滚"), "archive documents rollback");
  // plans API 仅查 is_active=true → trial3d 不外露
  const plans = read("src/app/api/subscription/plans/route.ts");
  assert.ok(plans.includes("eq(subscriptionPlans.isActive, true)"), "plans API active-only");
});
