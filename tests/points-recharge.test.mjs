// 积分充值（XorPay points 商品）契约测试（2026-10-07）：
//  1) 档位表：服务端唯一定价源（4 档、价格>0、积分唯一、量大优惠）；
//  2) pay/create：kind=points 分支（订单号 points-<积分>-<uid>-<nonce>、价格取服务端表、
//     非法档位 400 + code=INVALID_POINTS_PACK、不读客户端 amount、校验在鉴权与 XorPay 下单之前）；
//  3) pay/notify：points 履约（order_id 解析、points_log.ref 幂等 ON CONFLICT、原子入账 users.points）；
//  4) 数据层：points_log.ref 列 + 唯一索引 + SCHEMA_VERSION ≥ 13；
//  5) /points 页：充值入口（档位按钮 + PointsRechargeModal）+ 充值记录过滤 + i18n 双语；
//  6) smoke：43-44 两项 points 用例 + 总数 44。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { POINTS_PACKS, findPointsPack } from "../src/lib/points-recharge.ts";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("points-recharge(1): 档位表 4 档、价格>0、积分唯一、每元积分随档位递增（量大优惠）", () => {
  assert.equal(POINTS_PACKS.length, 4);
  const seen = new Set();
  for (const p of POINTS_PACKS) {
    assert.ok(Number.isInteger(p.points) && p.points > 0, "points must be positive int");
    assert.ok(p.priceCny > 0, "price must be positive");
    assert.ok(!seen.has(p.points), "duplicate pack points");
    seen.add(p.points);
  }
  const ratios = POINTS_PACKS.map((p) => p.points / p.priceCny);
  for (let i = 1; i < ratios.length; i += 1) {
    assert.ok(ratios[i] >= ratios[i - 1], "bulk discount: 每元积分应随档位递增");
  }
  assert.equal(findPointsPack(100)?.priceCny, POINTS_PACKS[0].priceCny);
  assert.equal(findPointsPack(123), undefined, "非法档位必须查无");
});

test("points-recharge(2): pay/create kind=points 服务端定价 + 非法档位 400（不触达 XorPay）", () => {
  const src = read("../src/app/api/pay/create/route.ts");
  assert.match(src, /import \{ findPointsPack \} from "@\/lib\/points-recharge"/);
  assert.match(src, /"unlock" \| "cosmetic" \| "premium" \| "blindbox" \| "points"/);
  assert.match(src, /code: "INVALID_POINTS_PACK"/);
  assert.match(src, /apiError\(locale, "invalidPointsPack"\)/);
  // 订单号契约：pay/notify 解析依赖此格式（points-<积分>-<userId>-<nonce>）
  assert.match(src, /order_id = `points-\$\{pack\.points\}-\$\{user\.id\}-\$\{nonce\}`/);
  // 价格只取服务端档位表
  assert.match(src, /price = pack\.priceCny\.toFixed\(2\)/);
  // 客户端 amount 仅 unlock 分支使用（points 分支绝不读客户端金额，防改价）
  assert.equal(src.split("body?.amount").length - 1, 1, "body?.amount 只允许出现在 unlock 分支");
  // 非法档位校验必须早于鉴权与 XorPay 下单（保证 smoke 400 用例不产生外部调用）
  assert.ok(src.indexOf("INVALID_POINTS_PACK") < src.indexOf("getUserFromRequest(req)"),
    "档位校验必须先于鉴权");
  assert.ok(src.indexOf("INVALID_POINTS_PACK") < src.indexOf("createXorpayOrder({"),
    "档位校验必须先于 XorPay 下单");
  // points 不需要宠物归属校验（Phase 6 重构为正向列举：仅 unlock/cosmetic 有归属校验，行为等价）
  assert.match(src, /仅 unlock \/ cosmetic 需要领养记录归属校验/);
});

test("points-recharge(3): pay/notify 幂等履约（ref 唯一约束 + 原子入账）", () => {
  const src = read("../src/app/api/pay/notify/route.ts");
  assert.match(src, /import \{ findPointsPack \} from "@\/lib\/points-recharge"/);
  assert.match(src, /\^points-\(\\d\+\)-/);
  assert.match(src, /INSERT INTO points_log \(user_id, amount, reason, ref\)/);
  assert.match(src, /VALUES \(\$1::uuid, \$2, 'recharge', \$3\)/);
  assert.match(src, /ON CONFLICT \(ref\) DO NOTHING/);
  assert.match(src, /UPDATE users SET points = points \+ \$2/);
  // 未知档位（非本站生成的订单号）不入账（防伪造纵深）
  assert.match(src, /unknown pack, skipped/);
});

test("points-recharge(4): 数据层 ref 列 + 唯一索引 + SCHEMA_VERSION ≥ 13", () => {
  const schema = read("../src/db/schema.ts");
  assert.match(schema, /ref: text\('ref'\)/);
  const client = read("../src/db/client.ts");
  assert.match(client, /ALTER TABLE "points_log" ADD COLUMN IF NOT EXISTS "ref" text/);
  assert.match(client, /CREATE UNIQUE INDEX IF NOT EXISTS idx_points_log_ref ON "points_log" \("ref"\)/);
  // CREATE TABLE（新装库路径）也必须包含 ref 列
  const createBlock = client.match(/CREATE TABLE IF NOT EXISTS "points_log" \([\s\S]*?\)`,/);
  assert.ok(createBlock && createBlock[0].includes('"ref" text'), "points_log CREATE 需含 ref 列");
  const ver = client.match(/const SCHEMA_VERSION = (\d+);/);
  assert.ok(ver && Number(ver[1]) >= 13, "SCHEMA_VERSION 必须 ≥ 13（ref 列迁移）");
});

test("points-recharge(5): /points 页充值入口 + 充值记录 + 弹窗链路", () => {
  const page = read("../src/app/[locale]/points/page.tsx");
  assert.match(page, /POINTS_PACKS/);
  assert.match(page, /PointsRechargeModal/);
  assert.match(page, /recharge: t\("recharge"\)/);
  assert.match(page, /l\.reason === "recharge"/);
  const modal = read("../src/components/points-recharge-modal.tsx");
  assert.match(modal, /\/api\/pay\/create/);
  assert.match(modal, /kind: "points", points: pack\.points/);
  // 到账轮询：/api/auth/me 余额 ≥ 基线 + 档位积分
  assert.match(modal, /now >= baselinePoints \+ pack\.points/);
});

test("points-recharge(6): i18n 双语（points 命名空间 + api 错误）", () => {
  const zh = JSON.parse(read("../messages/zh.json"));
  const en = JSON.parse(read("../messages/en.json"));
  for (const dict of [zh, en]) {
    for (const k of [
      "rechargeTitle", "rechargeSub", "rechargeDesc", "packPointsLabel",
      "rechargeOk", "rechargeFail", "rechargeHistory", "rechargeEmpty", "recharge",
    ]) {
      assert.ok(dict.points?.[k], `points.${k} missing`);
    }
    assert.ok(dict.api?.invalidPointsPack, "api.invalidPointsPack missing");
  }
});

test("points-recharge(7): smoke 新增 2 项 points 用例 + 总数随 NFR 步骤更新", () => {
  const smoke = read("../scripts/smoke-production.mjs");
  assert.match(smoke, /INVALID_POINTS_PACK/);
  assert.match(smoke, /kind: "points", points: 100/);
  // 2026-10-08 NFR 繁育/转赠 UI 落地后冒烟扩至 50 步；2026-10-13 断签补签 51-52 两步 → 52（tests/nfr-actions.test.mjs 锁定总数）
  assert.match(smoke, /stepNo === 52/);
});
