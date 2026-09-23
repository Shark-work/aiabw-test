/**
 * 探索 V1 → V2 迁移（P0）契约测试
 *
 * 背景（见 .clinerules/roadmap.md 三，2026-09-23 代码核实）：
 *  - V1（聊天驱动挂机探索）从未有独立页面，/explore 在 git 历史中不存在；
 *    真实入口是聊天页的 ExplorationMap 挂件（/api/exploration/step 随聊天推进）。
 *  - P0 落地：① /[locale]/explore 308 重定向 → /[locale]/explore-v2（URL 兼容）；
 *             ② 挂件顶部加 V2 引导条（真实入口引导迁移）；
 *             ③ V1 数据（步数 / 明信片 / 道具）原表保留，迁移期两系统并行。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname ?? __dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

// === 1) /[locale]/explore 页面存在且 308 重定向到 /[locale]/explore-v2 ===
test("explore v1 migration: /[locale]/explore redirects permanently to /explore-v2", () => {
  const p = join(ROOT, "src/app/[locale]/explore/page.tsx");
  assert.ok(existsSync(p), "src/app/[locale]/explore/page.tsx must exist");
  const c = read("src/app/[locale]/explore/page.tsx");
  assert.ok(c.includes("permanentRedirect"), "must use permanentRedirect (308)");
  assert.ok(
    c.includes("permanentRedirect(`/${locale}/explore-v2`)"),
    "must redirect to /${locale}/explore-v2 keeping locale prefix",
  );
});

// === 2) V1 真实入口（聊天页挂件 ExplorationMap）顶部含 V2 引导条 ===
test("explore v1 migration: ExplorationMap banner links to /explore-v2", () => {
  const c = read("src/components/exploration/exploration-map.tsx");
  assert.ok(c.includes('data-testid="explore-v2-banner"'), "banner testid missing");
  assert.ok(
    c.includes("explore-v2") && c.includes("useLocale"),
    "banner must link to /<locale>/explore-v2 via useLocale()",
  );
});

// === 3) i18n：exploration.v2Banner 双语齐备 ===
test("explore v1 migration: v2Banner copy exists in zh & en", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  assert.ok(
    typeof zh.exploration?.v2Banner === "string" && zh.exploration.v2Banner.length > 0,
    "zh exploration.v2Banner missing",
  );
  assert.ok(
    typeof en.exploration?.v2Banner === "string" && en.exploration.v2Banner.length > 0,
    "en exploration.v2Banner missing",
  );
});

// === 4) 数据兼容：V1 数据列/表保留（不删），V2 目标表存在 ===
test("explore v1 migration: schema keeps V1 data and has V2 target tables", () => {
  const c = read("src/db/schema.ts");
  // V1 迁移期保留：P1 成就系统按 max(Σsteps÷100, COUNT(user_postcards)) 回填徽章进度
  assert.ok(c.includes("exploration_steps"), "adoptions.exploration_steps must be kept");
  assert.ok(c.includes("user_postcards"), "user_postcards must be kept (V1 探索次数口径)");
  assert.ok(c.includes("map_events"), "map_events must be kept");
  // V2 迁移落点
  assert.ok(c.includes("exploration_records"), "exploration_records (V2) missing");
  assert.ok(c.includes("exploration_events"), "exploration_events (V2) missing");
});

// === 5) 迁移期 V1 API 保持可用（删除属于 P2 步骤 4）===
test("explore v1 migration: V1 exploration APIs remain available during migration", () => {
  for (const rel of [
    "src/app/api/exploration/step/route.ts",
    "src/app/api/exploration/status/route.ts",
    "src/app/api/exploration/postcards/route.ts",
  ]) {
    assert.ok(existsSync(join(ROOT, rel)), `${rel} must remain during migration`);
  }
});
