/**
 * P1 故事外显 · 探索产出外显契约测试（2026-10-14，改动四）
 *
 * 覆盖（验收口径：明信片墙可查看/收集 + 集齐图鉴奖励 + 灵宠探索履历）：
 *  1) postcard-config：5 系列 / 奖励 30 积分 / badge_id 格式与前缀；
 *  2) GET /api/exploration/postcards：401 + postcard 记录（JOIN events 取系列）
 *     + 系列全集 GROUP BY + 已领取查询（achievements 前缀）+ result_data 反序列化；
 *  3) POST：服务端权威重算 + 未集齐 400 + ON CONFLICT 幂等 + 积分同事务入账 + 409；
 *  4) PostcardWall：数据源 / 领取调用 / 稀有特效边框 / 故事弹窗 / refreshKey 重拉 / 面板挂载；
 *  5) ExplorationDigest：复用 history?limit=5 + companion-panel 挂载；
 *  6) i18n：postcardWall / digest 命名空间 + api 4 新错误码（zh/en 对齐）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  POSTCARD_BADGE_PREFIX,
  POSTCARD_SET_REWARD_POINTS,
  POSTCARD_SETS,
  postcardSetBadgeId,
} from "../src/lib/postcard-config.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const zh = JSON.parse(read("messages/zh.json"));
const en = JSON.parse(read("messages/en.json"));

// === 1) postcard-config ===
test("postcard config: 5 series / reward / badge id format", () => {
  assert.equal(POSTCARD_SETS.length, 5, "cat/fox/dog/rabbit/bird");
  for (const c of ["cat", "fox", "dog", "rabbit", "bird"]) {
    assert.ok(POSTCARD_SETS.some((s) => s.category === c), `series ${c}`);
  }
  assert.equal(POSTCARD_SET_REWARD_POINTS, 30);
  assert.equal(postcardSetBadgeId("cat"), "postcard-cat");
  assert.ok(postcardSetBadgeId("fox").startsWith(POSTCARD_BADGE_PREFIX));
});

// === 2) GET /api/exploration/postcards ===
test("postcards GET: 401 + postcard rows joined with series + claimed from achievements", () => {
  const c = read("src/app/api/exploration/postcard-wall/route.ts");
  assert.ok(c.includes("export async function GET"), "GET handler");
  assert.ok(c.includes("{ status: 401 }"), "unauthenticated 401");
  assert.ok(c.includes("FROM exploration_records r"), "records source");
  assert.ok(c.includes("r.result_type = 'postcard'"), "postcard filter");
  assert.ok(c.includes("LEFT JOIN exploration_events e ON e.id = r.event_id"), "series via events");
  assert.ok(c.includes("GROUP BY e.pet_category"), "series totals GROUP BY pet_category");
  assert.ok(c.includes("deserializeResultData"), "story text from result_data");
  assert.ok(c.includes("POSTCARD_BADGE_PREFIX"), "claimed via badge prefix");
  assert.ok(c.includes(".from(achievements)"), "achievements claimed source");
});

// === 3) POST /api/exploration/postcards（领取） ===
test("postcards POST: server-side recount + incomplete 400 + idempotent credit + 409", () => {
  const c = read("src/app/api/exploration/postcard-wall/route.ts");
  assert.ok(c.includes("export async function POST"), "POST handler");
  assert.ok(c.includes("count(DISTINCT r.event_id)::int AS owned"), "recount owned distinct events");
  assert.ok(!c.includes("body?.owned"), "never trusts client count");
  assert.ok(c.includes('"INVALID_SET"'), "unknown series 400");
  assert.ok(c.includes('"SET_INCOMPLETE"'), "incomplete 400");
  assert.ok(c.includes(".onConflictDoNothing()"), "ON CONFLICT idempotent");
  assert.ok(c.includes("badgeId, progress: total"), "progress snapshot = set size");
  assert.ok(
    c.includes("users.points} + ${POSTCARD_SET_REWARD_POINTS}"),
    "points += reward",
  );
  assert.ok(c.includes('reason: "achievement"'), "points_log reason");
  assert.ok(c.includes('"ALREADY_CLAIMED"'), "duplicate claim 409");
  assert.ok(c.includes("{ status: 409 }"), "409 status");
});

// === 4) PostcardWall 组件 + 面板挂载 ===
test("postcard wall: data source / claim / rare frames / story modal / refresh / mounted", () => {
  const w = read("src/components/exploration-v2/postcard-wall.tsx");
  assert.ok(w.includes('fetch("/api/exploration/postcard-wall"'), "GET data source");
  assert.ok(w.includes('method: "POST"'), "claim POST");
  assert.ok(w.includes("body: JSON.stringify({ category })"), "claim body");
  assert.ok(w.includes("border-sky-300"), "rare frame");
  assert.ok(w.includes("border-violet-400"), "epic frame");
  assert.ok(w.includes("setSelected(card)"), "tap to view story");
  assert.ok(w.includes("selected.description"), "story text rendered");
  assert.ok(w.includes("[load, refreshKey]"), "refetch on refreshKey");
  assert.ok(/claimSuccess[\s\S]{0,200}?await load\(\)/.test(w), "reload after claim");
  const p = read("src/components/exploration-v2/explore-v2-panel.tsx");
  assert.ok(
    p.includes('import { PostcardWall } from "@/components/exploration-v2/postcard-wall"'),
    "import",
  );
  assert.ok(p.includes("<PostcardWall refreshKey={achvRefreshKey} />"), "mounted");
});

// === 5) ExplorationDigest（灵宠详情探索履历） ===
test("exploration digest: reuses history?limit=5 + mounted in companion panel", () => {
  const d = read("src/components/pets/exploration-digest.tsx");
  assert.ok(d.includes('fetch("/api/exploration/history?limit=5"'), "history limit=5 reuse");
  assert.ok(d.includes("r.isRare"), "rare highlight");
  assert.ok(d.includes('href="/explore-v2"'), "empty CTA to explore");
  const p = read("src/components/pets/companion-panel.tsx");
  assert.ok(p.includes('import { ExplorationDigest } from "./exploration-digest"'), "import");
  assert.ok(p.includes("<ExplorationDigest />"), "mounted in pet detail");
});

// === 6) i18n（zh/en 对齐） ===
test("postcard wall i18n: namespaces + api error keys aligned zh/en", () => {
  for (const dict of [zh, en]) {
    const w = dict.explorationV2?.postcardWall;
    assert.ok(w, "explorationV2.postcardWall");
    for (const k of [
      "title", "subtitle", "empty", "collected", "claim", "claimed",
      "claimSuccess", "claimFailed", "storyTitle", "rare", "epic",
    ]) {
      assert.ok(w[k], `postcardWall.${k}`);
    }
    assert.ok(w.collected.includes("{owned}") && w.collected.includes("{total}"), "collected params");
    assert.ok(w.claim.includes("{points}"), "claim param");
    const dg = dict.myPets?.digest;
    for (const k of ["title", "empty", "emptyCta", "rare"]) {
      assert.ok(dg[k], `myPets.digest.${k}`);
    }
    for (const k of [
      "postcardSetInvalid", "postcardSetIncomplete",
      "postcardSetClaimed", "postcardSetClaimFailed",
    ]) {
      assert.ok(dict.api[k], `api.${k}`);
    }
  }
});

