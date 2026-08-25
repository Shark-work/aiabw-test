import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateInviteCode,
  getClientIp,
  INVITE_REWARD_POINTS,
  WELCOME_BONUS_POINTS,
  INVITE_DAILY_LIMIT,
} from "../src/lib/referral.ts";

test("referral: invite code is 6 chars uppercase alphanumeric", () => {
  const code = generateInviteCode();
  assert.equal(code.length, 6);
  assert.match(code, /^[A-Z0-9]{6}$/);
});

test("referral: invite codes are unique in practice", () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const code = generateInviteCode();
    assert.ok(!seen.has(code), `collision: ${code}`);
    seen.add(code);
  }
});

test("referral: custom length works", () => {
  assert.equal(generateInviteCode(12).length, 12);
});

test("referral: reward amount is 50 points / welcome bonus 20", () => {
  assert.equal(INVITE_REWARD_POINTS, 50);
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
