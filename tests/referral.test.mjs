import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateInviteCode,
  getClientIp,
  INVITE_REWARD_VIP_DAYS,
  WELCOME_BONUS_POINTS,
  INVITE_DAILY_LIMIT,
} from "../src/lib/referral.ts";

test("referral: invite code is 6 chars uppercase alphanumeric", () => {
  const code = generateInviteCode();
  assert.equal(code.length, 6);
  assert.match(code, /^[A-Z0-9]{6}$/);
});

test("referral: invite codes are unique in practice", () => {
  // 生日悖论：36^6 ≈ 2.18e9 编码空间，5000 次抽样期望碰撞 ≈ 5000²/(2·36^6) ≈ 0.006，
  // 「零碰撞」断言自带 ~0.6%/run flake（2026-09-30 实测命中 collision: FY3ID2）。
  // 改为统计容差：碰撞 ≤2（Poisson λ≈0.006 下 P(≥3) < 1e-7，等价确定性）。
  // 生产唯一性由 UNIQUE INDEX idx_users_invite_code + 注册 6 次重试循环兜底，
  // 不依赖抽样零碰撞（register/route.ts L63-65）。
  const seen = new Set();
  let collisions = 0;
  for (let i = 0; i < 5000; i++) {
    const code = generateInviteCode();
    if (seen.has(code)) collisions++;
    seen.add(code);
  }
  assert.ok(collisions <= 2, `too many collisions: ${collisions}`);
});

test("referral: custom length works", () => {
  assert.equal(generateInviteCode(12).length, 12);
});

test("referral: reward is 3-day VIP for both sides / welcome bonus 20 points", () => {
  // P0 概念收敛（2026-10-14）：邀请返利从「邀请人 +50 积分」升级为「双方各 3 天 VIP」
  assert.equal(INVITE_REWARD_VIP_DAYS, 3);
  assert.equal(WELCOME_BONUS_POINTS, 20);
  assert.equal(INVITE_DAILY_LIMIT, 3);
});

test("referral: getClientIp parses x-forwarded-for (first hop)", () => {
  const req = new Request("https://aiabw.com/api/auth/register", {
    headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
  });
  assert.equal(getClientIp(req), "1.2.3.4");
});

test("referral: getClientIp falls back to x-real-ip", () => {
  const req = new Request("https://aiabw.com/api/auth/register", {
    headers: { "x-real-ip": "9.9.9.9" },
  });
  assert.equal(getClientIp(req), "9.9.9.9");
});

test("referral: getClientIp returns empty when no headers", () => {
  const req = new Request("https://aiabw.com/api/auth/register");
  assert.equal(getClientIp(req), "");
});
