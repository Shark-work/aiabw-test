/**
 * P2 社交传播 · 季节活动骨架契约测试（改动三）
 *
 * 覆盖（验收口径：配置表 + 进度表 + 接口可用，默认无活动外露）：
 *  1) schema：seasonal_events + user_seasonal_progress（0033 幂等 + UNIQUE + 占位种子关闭）+ SCHEMA_VERSION 18；
 *  2) config 纯函数：isSeasonalEventActive 三态 + seasonalText locale；
 *  3) 查询层：进行中筛选 + UPSERT 仅对进行中活动 + 进度默认零；
 *  4) GET /api/seasonal-events/active：匿名可读 + event=null 形态 + 登录附进度；
 *  5) SeasonalEventBanner：无活动不渲染 + 名称/进度/奖励预览 + explore-v2 挂载；
 *  6) 进度挂点：exploration/start（exploration:1）+ pets/breed（bondCrystals:1），失败不阻断；
 *  7) i18n：seasonal 命名空间 + seasonalEventFailed（zh/en 对齐）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  isSeasonalEventActive,
  seasonalText,
} from "../src/lib/seasonal-config.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const zh = JSON.parse(read("messages/zh.json"));
const en = JSON.parse(read("messages/en.json"));

// === 1) schema ===
test("schema: two tables + unique + placeholder inactive + SCHEMA_VERSION 18", () => {
  const schema = read("src/db/schema.ts");
  assert.ok(schema.includes("export const seasonalEvents = pgTable('seasonal_events'"), "events table");
  assert.ok(schema.includes("export const userSeasonalProgress = pgTable('user_seasonal_progress'"), "progress table");
  assert.ok(schema.includes("unique('user_seasonal_progress_user_event_unique')"), "unique(user,event)");
  const sql = read("drizzle/0033_seasonal_events.sql");
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS "seasonal_events"'), "idempotent events");
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS "user_seasonal_progress"'), "idempotent progress");
  assert.ok(sql.includes("'placeholder'"), "placeholder seed");
  assert.match(sql, /ON CONFLICT \("slug"\) DO NOTHING/, "seed idempotent");
  assert.match(sql, /false,\s*\n\s*'\{"points":100\}'::jsonb/, "placeholder inactive");
  const client = read("src/db/client.ts");
  // 版本号随后续迭代递增（产品升级 Phase 1 已至 v19）→ 锁「v18 已引入」而非当前版本值
  assert.match(client, /const SCHEMA_VERSION = (1[8-9]|[2-9]\d);/, "SCHEMA_VERSION >= 18");
  assert.ok(client.includes("'placeholder'"), "client seed");
});

// === 2) config 纯函数 ===
test("config: isSeasonalEventActive tri-state + seasonalText locale", () => {
  const now = new Date("2026-10-14T00:00:00Z");
  const base = { isActive: true, startAt: new Date("2026-10-01"), endAt: new Date("2026-10-31") };
  assert.equal(isSeasonalEventActive(base, now), true, "active in window");
  assert.equal(isSeasonalEventActive({ ...base, isActive: false }, now), false, "switch off");
  assert.equal(
    isSeasonalEventActive({ ...base, startAt: new Date("2026-11-01"), endAt: new Date("2026-11-30") }, now),
    false,
    "outside window",
  );
  assert.equal(seasonalText({ zh: "秋日祭", en: "Autumn Fest" }, "zh"), "秋日祭");
  assert.equal(seasonalText({ zh: "秋日祭", en: "Autumn Fest" }, "en"), "Autumn Fest");
});


// === 3) 查询层 ===
test("queries: active window filter + upsert active-only + progress default zero", () => {
  const q = read("src/server/queries/seasonal-queries.ts");
  assert.ok(q.includes("WHERE is_active AND start_at <= now() AND end_at >= now()"), "active window SQL");
  assert.ok(q.includes('ON CONFLICT ("user_id", "event_id") DO UPDATE SET'), "upsert");
  assert.ok(q.includes("exploration_count = user_seasonal_progress.exploration_count + $2"), "exp accumulate");
  assert.ok(q.includes("bond_crystals = user_seasonal_progress.bond_crystals + $3"), "crystal accumulate");
  assert.ok(q.includes("if (exp === 0 && crystals === 0) return"), "no-op guard");
  assert.ok(q.includes("Number(r?.explorationCount ?? 0)"), "progress default zero");
});

// === 4) GET /api/seasonal-events/active ===
test("active route: anonymous readable + event null shape + progress when authed", () => {
  const r = read("src/app/api/seasonal-events/active/route.ts");
  assert.ok(r.includes("getActiveSeasonalEvent()"), "query reuse");
  assert.ok(r.includes("{ ok: true, event, progress }"), "null event shape");
  assert.ok(r.includes("getUserFromRequest(req)"), "optional auth for progress");
  assert.ok(r.includes("getSeasonalProgress(user.id, event.slug)"), "progress lookup");
  assert.ok(!r.includes("status: 401"), "anonymous not blocked");
});

// === 5) SeasonalEventBanner ===
test("banner: hidden without event + name/progress/rewards + mounted on explore-v2", () => {
  const b = read("src/components/exploration-v2/seasonal-event-banner.tsx");
  assert.ok(b.includes('fetch("/api/seasonal-events/active"'), "data source");
  assert.ok(b.includes("if (!data) return null"), "hidden without event");
  assert.ok(b.includes("seasonalText(event.name, locale)"), "i18n name");
  assert.ok(b.includes('t("progress", {'), "progress line");
  assert.ok(b.includes('t("rewardPoints", { n: event.rewards.points })'), "points preview");
  assert.ok(b.includes('t("rewardVipDays", { n: event.rewards.vipDays })'), "vip preview");
  const p = read("src/app/[locale]/explore-v2/page.tsx");
  assert.ok(p.includes("<SeasonalEventBanner />"), "mounted");
});

// === 6) 进度挂点 ===
test("progress hooks: exploration/start + pets/breed, non-blocking", () => {
  const s = read("src/app/api/exploration/start/route.ts");
  assert.ok(s.includes("await trackSeasonalProgress(user.id, { exploration: 1 })"), "exploration +1");
  assert.ok(s.includes("seasonal track failed"), "catch non-blocking");
  const b = read("src/app/api/pets/breed/route.ts");
  assert.ok(b.includes("await trackSeasonalProgress(user.id, { bondCrystals: 1 })"), "crystal +1");
  assert.ok(b.includes("seasonal track failed"), "catch non-blocking");
});

// === 7) i18n（zh/en 对齐） ===
test("seasonal i18n: banner keys + api error key aligned zh/en", () => {
  for (const dict of [zh, en]) {
    const s = dict.seasonal;
    for (const k of ["until", "progress", "claimed", "rewardPoints", "rewardVipDays"]) {
      assert.ok(s[k], `seasonal.${k}`);
    }
    assert.ok(s.progress.includes("{e}") && s.progress.includes("{c}"), "progress params");
    assert.ok(JSON.stringify(dict).includes('"seasonalEventFailed"'), "api error key");
  }
});
