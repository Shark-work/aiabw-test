// 每日签到积分 · 加权随机（1-10，递减分布）契约测试。
// 需求（2026-09）：固定 +10 → 随机 1-10；1-3 ≈50% / 4-6 ≈30% / 7-9 ≈15% / 10 ≈5%。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHECKIN_POINTS_MAX,
  CHECKIN_POINTS_MIN,
  CHECKIN_POINTS_TIERS,
  rollCheckinPoints,
} from "../src/lib/checkin-points.ts";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("checkin-points: tier weights = 50/30/15/5 (sum = 1), ranges cover 1-10", () => {
  const weights = CHECKIN_POINTS_TIERS.map((t) => t.weight);
  assert.deepEqual(weights, [0.5, 0.3, 0.15, 0.05]);
  assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-9, "weights must sum to 1");
  assert.deepEqual(
    CHECKIN_POINTS_TIERS.map((t) => [t.min, t.max]),
    [[1, 3], [4, 6], [7, 9], [10, 10]],
    "tiers must contiguously cover 1-10",
  );
  assert.equal(CHECKIN_POINTS_MIN, 1);
  assert.equal(CHECKIN_POINTS_MAX, 10);
});

test("checkin-points: roll boundaries deterministic per tier", () => {
  assert.equal(rollCheckinPoints(0, 0), 1); // 档 1 起点
  assert.equal(rollCheckinPoints(0.4999, 0.999), 3); // 档 1 末尾
  assert.equal(rollCheckinPoints(0.5, 0), 4); // 档 2 起点（50% 边界落入档 2）
  assert.equal(rollCheckinPoints(0.7999, 0.999), 6); // 档 2 末尾
  assert.equal(rollCheckinPoints(0.8, 0), 7); // 档 3 起点
  assert.equal(rollCheckinPoints(0.9499, 0.999), 9); // 档 3 末尾
  assert.equal(rollCheckinPoints(0.95, 0), 10); // 头奖起点（95% 边界落入 10）
  assert.equal(rollCheckinPoints(0.9999, 0.999), 10); // 头奖
});

test("checkin-points: pickRand selects uniformly within tier", () => {
  assert.equal(rollCheckinPoints(0.1, 0), 1);
  assert.equal(rollCheckinPoints(0.1, 0.34), 2);
  assert.equal(rollCheckinPoints(0.1, 0.99), 3);
  assert.equal(rollCheckinPoints(0.6, 0), 4);
  assert.equal(rollCheckinPoints(0.6, 0.99), 6);
  assert.equal(rollCheckinPoints(0.9, 0), 7);
  assert.equal(rollCheckinPoints(0.9, 0.99), 9);
});

test("checkin-points: statistical distribution matches spec (200k rolls)", () => {
  const N = 200_000;
  const tierCount = [0, 0, 0, 0];
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < N; i++) {
    const v = rollCheckinPoints();
    assert.ok(Number.isInteger(v) && v >= 1 && v <= 10, `value ${v} must be int in 1-10`);
    min = Math.min(min, v);
    max = Math.max(max, v);
    if (v <= 3) tierCount[0]++;
    else if (v <= 6) tierCount[1]++;
    else if (v <= 9) tierCount[2]++;
    else tierCount[3]++;
  }
  assert.equal(min, 1, "1 should occur");
  assert.equal(max, 10, "10 should occur");
  const share = tierCount.map((c) => c / N);
  assert.ok(Math.abs(share[0] - 0.5) < 0.01, `tier 1-3 share ${share[0]} ≈ 50%`);
  assert.ok(Math.abs(share[1] - 0.3) < 0.01, `tier 4-6 share ${share[1]} ≈ 30%`);
  assert.ok(Math.abs(share[2] - 0.15) < 0.01, `tier 7-9 share ${share[2]} ≈ 15%`);
  assert.ok(Math.abs(share[3] - 0.05) < 0.005, `jackpot 10 share ${share[3]} ≈ 5%`);
});

test("checkin-points: 签到路由契约——使用加权随机，固定 10 已移除", () => {
  const src = read("../src/app/api/user/checkin/route.ts");
  assert.ok(src.includes('from "@/lib/checkin-points"'), "route must import checkin-points lib");
  assert.ok(src.includes("rollCheckinPoints("), "route must roll weighted points");
  assert.ok(!/const\s+CHECKIN_POINTS\s*=\s*10/.test(src), "fixed CHECKIN_POINTS = 10 must be gone");
  // 月卡倍率仍然作用于随机结果
  assert.ok(/rollCheckinPoints\(\)\s*\*\s*multiplier/.test(src), "premium multiplier must apply to rolled points");
});

test("checkin-points: 前端文案契约——不再承诺固定 +10，统一参数化 {points}", () => {
  const zh = JSON.parse(read("../messages/zh.json"));
  const en = JSON.parse(read("../messages/en.json"));
  for (const m of [zh, en]) {
    assert.ok(!m.home.checkin.includes("+10"), "home.checkin button must not promise +10");
    assert.ok(m.home.checkinOk.includes("{points}"), "home.checkinOk must be parameterized");
    assert.ok(!/\+10(?!\})/.test(m.home.checkinOk), "home.checkinOk must not hardcode +10");
    assert.ok(m.checkin.pointsGain.includes("{points}"), "checkin.pointsGain (modal) stays parameterized");
  }
  const homeSrc = read("../src/app/[locale]/page.tsx");
  assert.ok(homeSrc.includes('t("checkinOk", { points:'), "home page must pass actual pointsGain to checkinOk");
});
