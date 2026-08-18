import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateInviteCode,
  getClientIp,
  INVITE_REWARD_POINTS,
} from "../src/lib/referral.ts";

test("referral: invite code has fixed length and safe charset", () => {
  const code = generateInviteCode();
  assert.equal(code.length, 8);
  assert.match(code, /^[a-z0-9]{8}$/);
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

test("referral: reward amount is 50 points", () => {
  assert.equal(INVITE_REWARD_POINTS, 50);
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
