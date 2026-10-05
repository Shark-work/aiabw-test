// 断签补签（XorPay checkin_makeup 商品）契约测试（2026-10-13）：
//  1) lib：¥1 服务端定价 + localDateStr 格式 + 订单号 build/RE round-trip + 不误匹配其它商品前缀；
//  2) pay/create：kind=checkin_makeup 分支（订单号固化补签日期、价格取服务端常量、资格双校验
//     400 + code=NO_STREAK_TO_MAKEUP/NOT_BROKEN、校验在 XorPay 下单之前、无需 adoptionId）；
//  3) pay/notify：checkin-makeup 履约（MAKEUP_ORDER_RE 解析、幂等只前进 UPDATE、granted/no-op 日志）；
//  4) checkin 路由：P0-2 TODO 已落地（占位注释移除，注释指向 kind=checkin_makeup 链路）；
//  5) 前端：签到弹窗断签卡片 + /api/pay/create(kind=checkin_makeup) + 轮询 /api/user/checkin + PaymentModal；
//  6) i18n 双语（checkin.makeup* + api.noStreakToMakeup/notBroken）；
//  7) smoke：51-52 两项补签用例 + 总数 52。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CHECKIN_MAKEUP_PRICE_CNY,
  MAKEUP_ORDER_RE,
  localDateStr,
  makeupOrderId,
} from "../src/lib/checkin-makeup.ts";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("checkin-makeup(1): lib 常量 ¥1 + 日期格式 + 订单号 build/RE round-trip", () => {
  assert.equal(CHECKIN_MAKEUP_PRICE_CNY, 1, "补签定价 ¥1（P0-2）");
  assert.match(localDateStr(new Date("2026-10-13T08:30:00")), /^\d{4}-\d{2}-\d{2}$/);
  const uid = "123e4567-e89b-42d3-a456-426614174000";
  const oid = makeupOrderId(uid, "2026-10-12", "abc123");
  assert.equal(oid, `checkin-makeup-${uid}-2026-10-12-abc123`);
  const m = oid.match(MAKEUP_ORDER_RE);
  assert.ok(m, "RE 必须匹配自建订单号");
  assert.equal(m[1], uid);
  assert.equal(m[2], "2026-10-12");
  // 不误匹配其它商品前缀（履约分支隔离）
  assert.equal(MAKEUP_ORDER_RE.test(`points-100-${uid}-x`), false);
  assert.equal(MAKEUP_ORDER_RE.test(`unlock-${uid}-x`), false);
});

test("checkin-makeup(2): pay/create kind=checkin_makeup 服务端定价 + 资格双校验先于 XorPay", () => {
  const src = read("../src/app/api/pay/create/route.ts");
  assert.match(src, /import \{ CHECKIN_MAKEUP_PRICE_CNY, localDateStr, makeupOrderId \} from "@\/lib\/checkin-makeup"/);
  assert.match(src, /body\?\.kind === "checkin_makeup" \? "checkin_makeup"/);
  // 资格双校验（400 + 稳定 code，文案走 apiError 双语）
  assert.match(src, /code: "NO_STREAK_TO_MAKEUP"/);
  assert.match(src, /code: "NOT_BROKEN"/);
  assert.match(src, /apiError\(locale, "noStreakToMakeup"\)/);
  assert.match(src, /apiError\(locale, "notBroken"\)/);
  // 校验必须先于 XorPay 下单（冒烟 400 用例不产生外部调用）
  assert.ok(
    src.indexOf("NO_STREAK_TO_MAKEUP") < src.indexOf("createXorpayOrder({"),
    "资格校验必须先于 XorPay 下单",
  );
  // 分支契约：订单号由 lib 构建（固化补签日期），价格取服务端常量
  assert.match(src, /order_id = makeupOrderId\(user\.id, makeupDate, nonce\)/);
  assert.match(src, /price = CHECKIN_MAKEUP_PRICE_CNY\.toFixed\(2\)/);
  // 无需宠物：adoptionId 必需校验与归属校验均不覆盖 checkin_makeup
  // （Phase 6 重构为正向列举：仅 unlock/cosmetic 需要宠物维度，其余 kind 天然豁免——行为等价）
  assert.match(src, /kind === "unlock" \|\| kind === "cosmetic"\) \{\s*if \(!adoptionId\)/);
  assert.match(src, /仅 unlock \/ cosmetic 需要领养记录归属校验/);
  assert.match(src, /if \(kind === "unlock" \|\| kind === "cosmetic"\) \{\s*const \[a\] = await db/);
});

test("checkin-makeup(3): pay/notify 幂等履约（只前进 UPDATE + granted/no-op 日志）", () => {
  const src = read("../src/app/api/pay/notify/route.ts");
  assert.match(src, /import \{ MAKEUP_ORDER_RE \} from "@\/lib\/checkin-makeup"/);
  assert.match(src, /order_id\.match\(MAKEUP_ORDER_RE\)/);
  // 幂等 + 只前进：重复回调 / 已签到更晚日期 → 条件不满足 → no-op
  assert.match(src, /UPDATE users SET last_checkin_date = \$2/);
  assert.match(src, /last_checkin_date IS NULL OR last_checkin_date < \$2/);
  assert.match(src, /checkin makeup granted/);
  assert.match(src, /checkin makeup no-op/);
});

test("checkin-makeup(4): checkin 路由 P0-2 已落地（TODO 占位移除）", () => {
  const src = read("../src/app/api/user/checkin/route.ts");
  assert.ok(!/占位未实现/.test(src), "「占位未实现」TODO 注释必须移除");
  assert.match(src, /kind=checkin_makeup/);
});

test("checkin-makeup(5): 前端签到弹窗断签卡片 + 补签下单 + 到账轮询 + PaymentModal", () => {
  const src = read("../src/components/daily-checkin-modal.tsx");
  assert.match(src, /body: JSON\.stringify\(\{ kind: "checkin_makeup" \}\)/);
  assert.match(src, /import \{ PaymentModal \} from "@\/components\/payment-modal"/);
  assert.match(src, /import \{ CHECKIN_MAKEUP_PRICE_CNY \} from "@\/lib\/checkin-makeup"/);
  // 轮询 /api/user/checkin 判定到账（checkinDate >= 昨天）
  assert.match(src, /fetch\("\/api\/user\/checkin"/);
  assert.match(src, /data\.checkinDate >= yestStr\(\)/);
  // 断签判定：streak>0 且 last_checkin_date < 昨天
  assert.match(src, /status\.checkinDate < yestStr\(\)/);
  assert.match(src, /setMakeupPaid\(true\)/);
});

test("checkin-makeup(6): i18n 双语（checkin.makeup* + api 错误）", () => {
  const zh = JSON.parse(read("../messages/zh.json"));
  const en = JSON.parse(read("../messages/en.json"));
  for (const dict of [zh, en]) {
    for (const k of [
      "makeupTitle", "makeupDesc", "makeupBtn", "makeupPayTitle", "makeupPayDesc", "makeupOk", "makeupFail",
    ]) {
      assert.ok(dict.checkin?.[k], `checkin.${k} missing`);
    }
    assert.ok(dict.api?.noStreakToMakeup, "api.noStreakToMakeup missing");
    assert.ok(dict.api?.notBroken, "api.notBroken missing");
  }
});

test("checkin-makeup(7): smoke 51-52 补签用例 + 总数 52", () => {
  const smoke = read("../scripts/smoke-production.mjs");
  assert.match(smoke, /kind: "checkin_makeup"/);
  assert.match(smoke, /NO_STREAK_TO_MAKEUP/);
  assert.match(smoke, /stepNo === 52/);
});
