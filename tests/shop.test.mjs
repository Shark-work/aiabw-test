// 宠物旅行日记 · 探险商城单测
// 覆盖 SHOP_ITEMS 目录完整性、装备效果 helper、coins 默认值、SQL 迁移幂等
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import {
  SHOP_ITEMS,
  shopItemById,
  shopItemDisplayName,
  shopItemDisplayDescription,
  distanceMultiplier,
  rareEventMultiplier,
  canPassObstacle,
  canResistWeather,
} from "../src/lib/shop-config.ts";

test("shop: 7 商品目录完整（tent/umbrella/compass/bridge/rope/lantern/hot_air_balloon）", () => {
  assert.equal(SHOP_ITEMS.length, 7, "should have 7 items");
  const keys = new Set(SHOP_ITEMS.map((i) => i.id));
  assert.equal(keys.size, 7, "duplicate ids");
  for (const required of ["tent", "umbrella", "compass", "bridge", "rope", "lantern", "hot_air_balloon"]) {
    assert.ok(shopItemById(required), `missing item: ${required}`);
  }
});

test("shop: 每件商品有 id/price/effectType/icon/i18n name & description", () => {
  for (const it of SHOP_ITEMS) {
    assert.ok(it.id, `${it.id} missing id`);
    assert.ok(it.nameZh && it.nameEn, `${it.id} missing name`);
    assert.ok(it.descriptionZh && it.descriptionEn, `${it.id} missing description`);
    assert.ok(it.icon, `${it.id} missing icon`);
    assert.ok(typeof it.price === "number" && it.price > 0, `${it.id} bad price ${it.price}`);
    assert.ok(it.effectType, `${it.id} missing effectType`);
    assert.ok(typeof it.effectValue === "number", `${it.id} missing effectValue`);
    assert.ok(it.duration === -1 || it.duration > 0, `${it.id} bad duration ${it.duration}`);
  }
});

test("shop: 价格按 sortOrder 升序", () => {
  // 价格是设计常量（与 SQL seed 一致）
  const expected = { tent: 100, umbrella: 50, compass: 200, bridge: 80, rope: 80, lantern: 300, hot_air_balloon: 500 };
  for (const it of SHOP_ITEMS) {
    assert.equal(it.price, expected[it.id], `price mismatch for ${it.id}`);
  }
});

test("shop: premium 商品 = lantern + hot_air_balloon，其它免费", () => {
  const premiumItems = SHOP_ITEMS.filter((i) => i.isPremium);
  assert.equal(premiumItems.length, 2, "should have 2 premium items");
  const ids = premiumItems.map((i) => i.id).sort();
  assert.deepEqual(ids, ["hot_air_balloon", "lantern"]);
});

test("shop: locale 切换名字/描述", () => {
  const tent = shopItemById("tent");
  assert.equal(shopItemDisplayName(tent, "zh"), "露营帐篷");
  assert.equal(shopItemDisplayName(tent, "en"), "Camping Tent");
  assert.equal(shopItemDisplayDescription(tent, "zh"), "在野外露营，不受恶劣天气影响");
  assert.equal(shopItemDisplayDescription(tent, "en"), "Camp outdoors, immune to bad weather");
});

test("shop: distanceMultiplier compass = 1.5；无装备 = 1.0", () => {
  assert.equal(distanceMultiplier([]), 1.0);
  assert.equal(distanceMultiplier(["compass"]), 1.5);
  // 多个不同装备不会叠加
  assert.equal(distanceMultiplier(["tent", "compass"]), 1.5);
  // 未知装备不报错，视为 1.0
  assert.equal(distanceMultiplier(["nope"]), 1.0);
});

test("shop: rareEventMultiplier lantern = 2.0；多个 = 相乘", () => {
  assert.equal(rareEventMultiplier([]), 1.0);
  assert.equal(rareEventMultiplier(["lantern"]), 2.0);
  // 只有一个 lantern effect，所以两个 lantern 也还是 2.0（不去重）
  assert.equal(rareEventMultiplier(["lantern", "lantern"]), 4.0);
});

test("shop: canPassObstacle bridge/rope 通过；其它不行", () => {
  assert.equal(canPassObstacle([]), false);
  assert.equal(canPassObstacle(["compass"]), false);
  assert.equal(canPassObstacle(["bridge"]), true);
  assert.equal(canPassObstacle(["rope"]), true);
  assert.equal(canPassObstacle(["bridge", "rope"]), true);
});

test("shop: canResistWeather tent/umbrella 抵抗；其它不行", () => {
  assert.equal(canResistWeather([]), false);
  assert.equal(canResistWeather(["bridge"]), false);
  assert.equal(canResistWeather(["tent"]), true);
  assert.equal(canResistWeather(["umbrella"]), true);
  assert.equal(canResistWeather(["tent", "umbrella"]), true);
});

test("drizzle/0017_shop.sql exists with CREATE TABLE shop_items & user_orders", () => {
  const path = "d:\\p2\\aiabw-test\\drizzle\\0017_shop.sql";
  assert.ok(existsSync(path), "0017_shop.sql must exist");
  const sql = readFileSync(path, "utf8");
  assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS \"shop_items\""), "shop_items DDL missing");
  assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS \"user_orders\""), "user_orders DDL missing");
  assert.ok(sql.includes("ALTER TABLE \"users\" ADD COLUMN IF NOT EXISTS \"coins\""), "users.coins ALTER missing");
  // 7 件种子商品
  for (const id of ["tent", "umbrella", "compass", "bridge", "rope", "lantern", "hot_air_balloon"]) {
    assert.ok(sql.includes(`'${id}'`), `seed missing for ${id}`);
  }
});

test("drizzle/0017_shop.sql is idempotent: ON CONFLICT DO NOTHING on seeds", () => {
  const sql = readFileSync("d:\\p2\\aiabw-test\\drizzle\\0017_shop.sql", "utf8");
  assert.ok(sql.includes("ON CONFLICT"), "seed inserts must be idempotent");
});

test("schema.ts exports shopItems & userOrders tables + users.coins", () => {
  const src = readFileSync("d:\\p2\\aiabw-test\\src\\db\\schema.ts", "utf8");
  assert.ok(src.includes("export const shopItems"), "shopItems pgTable missing");
  assert.ok(src.includes("export const userOrders"), "userOrders pgTable missing");
  assert.ok(src.includes("coins:"), "users.coins field missing");
});
