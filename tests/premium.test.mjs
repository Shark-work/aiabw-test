import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPremium,
  compressForPremium,
  PREMIUM_PRICE_CNY,
  PREMIUM_DURATION_DAYS,
  PREMIUM_COMPRESS,
  FREE_COMPRESS,
} from "../src/lib/premium.ts";

test("premium: price is 1 CNY for 30 days", () => {
  assert.equal(PREMIUM_PRICE_CNY, 1);
  assert.equal(PREMIUM_DURATION_DAYS, 30);
});

test("premium: isPremium returns true while active", () => {
  const now = new Date();
  const active = new Date(now.getTime() + 10 * 24 * 3600 * 1000);
  assert.equal(isPremium(active, now), true);
});

test("premium: isPremium false when expired / null / past", () => {
  const now = new Date();
  assert.equal(isPremium(null, now), false);
  assert.equal(isPremium(undefined, now), false);
  assert.equal(isPremium(new Date(now.getTime() - 1000), now), false);
});

test("premium: compressForPremium gives longer context", () => {
  assert.deepEqual(FREE_COMPRESS, { maxTurns: 10, keepRecent: 5 });
  assert.deepEqual(PREMIUM_COMPRESS, { maxTurns: 20, keepRecent: 12 });
  assert.deepEqual(compressForPremium(false), FREE_COMPRESS);
  assert.deepEqual(compressForPremium(true), PREMIUM_COMPRESS);
  // 会员阈值严格高于普通
  assert.ok(PREMIUM_COMPRESS.maxTurns > FREE_COMPRESS.maxTurns);
  assert.ok(PREMIUM_COMPRESS.keepRecent > FREE_COMPRESS.keepRecent);
});
