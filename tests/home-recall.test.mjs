/**
 * P2 社交传播 · 首页「回来看看」提示契约测试（改动四）
 *
 * 覆盖（验收口径：对应条件下正确触发，点击跳转对应页面，中英双语）：
 *  1) buildReminders 纯函数：>24h→missYou / 低幸福度→feed / 未领图鉴→reward / 边界与叠加；
 *  2) GET /api/home/recall：401 + 纯函数复用 + 三数据源口径（last_login_at / 最低幸福度 / 未领系列）；
 *  3) RecallBanner：未登录空响应不渲染 + 三类跳转（/my-pets ×2、/explore-v2）；
 *  4) 首页挂载 + i18n recall（zh/en 对齐）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildReminders,
  RECALL_AWAY_HOURS,
  RECALL_LOW_HAPPINESS,
} from "../src/lib/recall-config.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const zh = JSON.parse(read("messages/zh.json"));
const en = JSON.parse(read("messages/en.json"));

const NOW = new Date("2026-10-14T12:00:00Z");
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000);
const base = { lastLoginAt: NOW, lowestHappiness: 100, lowestPetName: "团子", unclaimedSets: 0, now: NOW };

// === 1) buildReminders 纯函数 ===
test("buildReminders: triggers per condition + boundaries + stacking", () => {
  assert.equal(RECALL_AWAY_HOURS, 24);
  assert.equal(RECALL_LOW_HAPPINESS, 40);
  // 刚登录 + 健康 + 无待领 → 无提醒
  assert.deepEqual(buildReminders(base), []);
  // >24h 未登录 → missYou；恰好 24h 内不触发
  assert.deepEqual(buildReminders({ ...base, lastLoginAt: hoursAgo(25) }), [{ type: "missYou" }]);
  assert.deepEqual(buildReminders({ ...base, lastLoginAt: hoursAgo(23) }), []);
  // 从未登录（null）→ missYou
  assert.deepEqual(buildReminders({ ...base, lastLoginAt: null }), [{ type: "missYou" }]);
  // 低幸福度 → feed（带灵宠名）；阈值 40 不触发；无灵宠（null）不触发
  assert.deepEqual(buildReminders({ ...base, lowestHappiness: 39 }), [
    { type: "feed", petName: "团子" },
  ]);
  assert.deepEqual(buildReminders({ ...base, lowestHappiness: 40 }), []);
  assert.deepEqual(buildReminders({ ...base, lowestHappiness: null, lowestPetName: null }), []);
  // 未领图鉴 → reward（带系列数）
  assert.deepEqual(buildReminders({ ...base, unclaimedSets: 2 }), [{ type: "reward", count: 2 }]);
  // 三条件叠加 → 3 条全出
  const all = buildReminders({ lastLoginAt: hoursAgo(48), lowestHappiness: 10, lowestPetName: "团子", unclaimedSets: 1, now: NOW });
  assert.deepEqual(all.map((r) => r.type), ["missYou", "feed", "reward"]);
});

// === 2) GET /api/home/recall ===
test("recall route: 401 + pure fn reuse + three data sources", () => {
  const r = read("src/app/api/home/recall/route.ts");
  assert.ok(r.includes("status: 401"), "auth required");
  assert.ok(r.includes("buildReminders({"), "pure fn reuse");
  assert.ok(r.includes('last_login_at AS "lastLoginAt"'), "last_login_at source");
  assert.ok(r.includes("ORDER BY happiness ASC"), "lowest happiness pet");
  assert.ok(r.includes("event_type = 'postcard'"), "postcard sets");
  assert.ok(r.includes("count(DISTINCT r.event_id)"), "event_id dedupe (wall parity)");
  assert.ok(r.includes("a.badge_id = 'postcard-' || s.cat"), "claimed exclusion");
});

// === 3) RecallBanner ===
test("recall banner: hidden when empty + three jump targets + home mounted", () => {
  const b = read("src/components/home/recall-banner.tsx");
  assert.ok(b.includes('fetch("/api/home/recall"'), "data source");
  assert.ok(b.includes('localStorage.getItem("aiabw_token")'), "client auth gate");
  assert.ok(b.includes("if (reminders.length === 0) return null"), "hidden when empty");
  assert.ok(b.includes('t("feed", { name: r.petName ?? "" })'), "feed text with pet name");
  assert.ok(b.includes('t("reward", { n: r.count ?? 0 })'), "reward text with count");
  assert.ok(b.includes('href: "/my-pets"'), "missYou/feed → /my-pets");
  assert.ok(b.includes('href: "/explore-v2"'), "reward → /explore-v2");
  const home = read("src/app/[locale]/page.tsx");
  assert.ok(home.includes("<RecallBanner />"), "mounted on home");
});

// === 4) i18n（zh/en 对齐） ===
test("recall i18n: 4 keys + api error key aligned zh/en", () => {
  for (const dict of [zh, en]) {
    const r = dict.recall;
    for (const k of ["missYou", "feed", "reward", "cta"]) assert.ok(r[k], `recall.${k}`);
    assert.ok(r.feed.includes("{name}"), "feed param");
    assert.ok(r.reward.includes("{n}"), "reward param");
    assert.ok(JSON.stringify(dict).includes('"recallFailed"'), "api error key");
  }
});
