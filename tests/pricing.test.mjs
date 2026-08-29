import { test } from "node:test";
import assert from "node:assert/strict";

import {
  UNLOCK_PRICE_CNY,
  rarityTier,
  unlockPriceCny,
  unlockPriceCnyLabel,
} from "../src/lib/pricing.ts";

test("pricing: 价格阶梯配置（N/R/SR/SSR/UR）", () => {
  assert.equal(UNLOCK_PRICE_CNY.N, 1.0);
  assert.equal(UNLOCK_PRICE_CNY.R, 6.6);
  assert.equal(UNLOCK_PRICE_CNY.SR, 12.8);
  assert.equal(UNLOCK_PRICE_CNY.SSR, 19.9);
  assert.equal(UNLOCK_PRICE_CNY.UR, 29.9);
});

test("pricing: rarity → tier 映射", () => {
  assert.equal(rarityTier("common"), "N");
  assert.equal(rarityTier("uncommon"), "R");
  assert.equal(rarityTier("rare"), "SR");
  assert.equal(rarityTier("epic"), "SSR");
  assert.equal(rarityTier("legendary"), "UR");
  assert.equal(rarityTier("unknown"), "N");
  assert.equal(rarityTier(null), "N");
  assert.equal(rarityTier(undefined), "N");
});

test("pricing: 解锁价格（按稀有度动态计算）", () => {
  assert.equal(unlockPriceCny("common"), 1.0);
  assert.equal(unlockPriceCny("rare"), 12.8);
  assert.equal(unlockPriceCny("epic"), 19.9);
  assert.equal(unlockPriceCny("legendary"), 29.9);
  assert.equal(unlockPriceCnyLabel("common"), "1.0");
  assert.equal(unlockPriceCnyLabel("legendary"), "29.9");
});
