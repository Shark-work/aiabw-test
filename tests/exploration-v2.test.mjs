// 宠物旅行日记 v2 · 探索+养成+知识系统单测
// 覆盖：DDL 文件 + schema 导出 + DDL 已注入 client.ts + 伪宝猫种子数据 +
//      20+ 事件库种子 + 引擎函数 + JSON 解析 + 记录序列化
//      + API 路由文件 + i18n + 前端组件 + 页面
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  EVENT_TYPES,
  RARITY_LEVELS,
  EXPLORATION_V2_CONFIG,
  getMaxExplorations,
  getStepMultiplier,
  pickWeightedEvent,
  generateSteps,
  generateDistance,
  parseAnimalTraits,
  parseAnimalFunFacts,
  toKnowledgeSnapshot,
  serializeResultData,
  deserializeResultData,
  toEventResult,
} from "../src/lib/exploration-engine.ts";

import * as schemaModule from "../src/db/schema.ts";
import {
  animalWiki,
  explorationEventsV2,
  explorationRecords,
} from "../src/db/schema.ts";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
// === 1) DDL files ===
test("exploration v2: drizzle/0020_exploration_v2.sql exists with 3 tables + 4 indexes + 2 inserts", () => {
  const p = join(ROOT, "drizzle/0020_exploration_v2.sql");
  assert.ok(existsSync(p), `missing ${p}`);
  const c = readFileSync(p, "utf8");
  const tables = (c.match(/CREATE TABLE IF NOT EXISTS/g) || []).length;
  assert.equal(tables, 3, "should have 3 CREATE TABLE");
  const idx = (c.match(/CREATE INDEX IF NOT EXISTS/g) || []).length;
  assert.ok(idx >= 4, `should have >=4 indexes, got ${idx}`);
  const inserts = (c.match(/INSERT INTO/g) || []).length;
  assert.ok(inserts >= 2, `should have >=2 INSERT, got ${inserts}`);
  assert.ok(c.includes("persian-cat"), "should seed persian cat");
  assert.ok(c.includes("postcard"), "should mention postcard event type");
  assert.ok(c.includes("CHECK"), "should have CHECK constraints");
});

// === 2) schema exports ===
test("exploration v2: schema exports animalWiki / explorationEventsV2 / explorationRecords", () => {
  assert.equal(typeof animalWiki, "object");
  assert.equal(typeof explorationEventsV2, "object");
  assert.equal(typeof explorationRecords, "object");
  const names = Object.keys(schemaModule);
  assert.ok(names.includes("animalWiki"), "animalWiki not exported");
  assert.ok(names.includes("explorationEventsV2"), "explorationEventsV2 not exported");
  assert.ok(names.includes("explorationRecords"), "explorationRecords not exported");
});

// === 3) DDL injected in client.ts ===
test("exploration v2: client.ts SCHEMA_CREATES contains 3 new table DDLs", () => {
  const c = readFileSync(join(ROOT, "src/db/client.ts"), "utf8");
  assert.ok(c.includes('"animal_wiki"'), "animal_wiki not in SCHEMA_CREATES");
  assert.ok(c.includes('"exploration_events"'), "exploration_events not in SCHEMA_CREATES");
  assert.ok(c.includes('"exploration_records"'), "exploration_records not in SCHEMA_CREATES");
  assert.ok(c.includes("CREATE INDEX IF NOT EXISTS \"idx_exploration_records_user\""), "user index missing");
  assert.ok(c.includes("CREATE INDEX IF NOT EXISTS \"idx_exploration_records_user_time\""), "user_time index missing");
  assert.ok(c.includes("CREATE INDEX IF NOT EXISTS \"idx_exploration_events_type\""), "event type index missing");
  assert.ok(c.includes("CREATE INDEX IF NOT EXISTS \"idx_exploration_events_rarity\""), "event rarity index missing");
});

// === 4) Persian cat seed integrity ===
test("exploration v2: persian cat seed (iran / 12-17y / 5 fun_facts)", () => {
  const c = readFileSync(join(ROOT, "drizzle/0020_exploration_v2.sql"), "utf8");
  assert.ok(c.includes("iran".replace("iran", "伊朗")), "origin should be Iran");
  assert.ok(c.includes("12-17"), "lifespan 12-17 years");
  const persianBlock = c.split("INSERT INTO \"animal_wiki\"")[1] || "";
  const quoteCount = (persianBlock.match(/"/g) || []).length;
  // 5 traits + 5 fun_facts -> >=20 double quotes
  assert.ok(quoteCount >= 20, `persian wiki should have >=20 quotes, got ${quoteCount}`);
});

// === 5) 20+ events / 5 types / 3 rarities ===
test("exploration v2: event library has 20+ events / 5 types / 3 rarities / >=3 knowledge links", () => {
  const c = readFileSync(join(ROOT, "drizzle/0020_exploration_v2.sql"), "utf8");
  const evtIds = c.match(/evt-\d{3}/g) || [];
  assert.ok(evtIds.length >= 20, `expected >=20 events, got ${evtIds.length}`);
  for (const t of ["postcard", "gift", "knowledge", "encounter", "rest"]) {
    assert.ok(c.includes(`'${t}'`), `event type ${t} missing`);
  }
  for (const r of ["common", "rare", "epic"]) {
    assert.ok(c.includes(`'${r}'`), `rarity ${r} missing`);
  }
  const knowledgeLinks = (c.match(/'knowledge'.*?'persian-cat'/g) || []).length;
  assert.ok(knowledgeLinks >= 3, `expected >=3 knowledge events, got ${knowledgeLinks}`);
});
// === 6) Engine: capacity / multiplier ===
test("exploration v2: getMaxExplorations free=1, vip=3", () => {
  assert.equal(getMaxExplorations(false), 1);
  assert.equal(getMaxExplorations(true), 3);
  assert.equal(EXPLORATION_V2_CONFIG.FREE_DAILY_LIMIT, 1);
  assert.equal(EXPLORATION_V2_CONFIG.VIP_DAILY_LIMIT, 3);
});

test("exploration v2: getStepMultiplier free=1.0, vip=1.5", () => {
  assert.equal(getStepMultiplier(false), 1.0);
  assert.equal(getStepMultiplier(true), 1.5);
  assert.equal(EXPLORATION_V2_CONFIG.VIP_STEP_MULTIPLIER, 1.5);
});

// === 7) pickWeightedEvent weighted random ===
const SAMPLE_EVENTS = [
  { id: "a", petCategory: null, eventType: "postcard", title: "", description: "", imageEmoji: null, rarity: "common", weight: 1, requiredEquipment: null, knowledgeLink: null },
  { id: "b", petCategory: null, eventType: "postcard", title: "", description: "", imageEmoji: null, rarity: "common", weight: 9, requiredEquipment: null, knowledgeLink: null },
];

test("exploration v2: pickWeightedEvent boundary cases", () => {
  // total weight = 10; a = [0, 0.1), b = [0.1, 1.0)
  assert.equal(pickWeightedEvent(SAMPLE_EVENTS, { random: () => 0.05 }).id, "a");
  assert.equal(pickWeightedEvent(SAMPLE_EVENTS, { random: () => 0.95 }).id, "b");
  // r=0.85 -> 8.5/10 in b range
  assert.equal(pickWeightedEvent(SAMPLE_EVENTS, { random: () => 0.85 }).id, "b");
  // r=0.0 -> exactly a (0 <= 0.1)
  assert.equal(pickWeightedEvent(SAMPLE_EVENTS, { random: () => 0 }).id, "a");
});

test("exploration v2: pickWeightedEvent empty pool throws", () => {
  assert.throws(() => pickWeightedEvent([]), /non-empty/);
});

test("exploration v2: VIP rare weight x2 (statistical shift)", () => {
  // 1 common weight 100 + 1 rare weight 100; free: 50/50; VIP: 100*2 / (100+200) ~= 66.7%
  const events = [
    { id: "c", petCategory: null, eventType: "postcard", title: "", description: "", imageEmoji: null, rarity: "common", weight: 100, requiredEquipment: null, knowledgeLink: null },
    { id: "r", petCategory: null, eventType: "gift", title: "", description: "", imageEmoji: null, rarity: "rare", weight: 100, requiredEquipment: null, knowledgeLink: null },
  ];
  let freeRare = 0, vipRare = 0;
  for (let i = 0; i < 1000; i++) {
    if (pickWeightedEvent(events, { isVip: false, random: Math.random }).id === "r") freeRare++;
    if (pickWeightedEvent(events, { isVip: true, random: Math.random }).id === "r") vipRare++;
  }
  assert.ok(freeRare > 400 && freeRare < 600, `free rare should be ~500, got ${freeRare}`);
  assert.ok(vipRare > 580 && vipRare < 800, `vip rare should be ~667, got ${vipRare}`);
  assert.ok(vipRare > freeRare, `vip (${vipRare}) should exceed free (${freeRare})`);
});

// === 8) generateSteps / generateDistance ranges ===
test("exploration v2: generateSteps range [500, 3000] x multiplier", () => {
  assert.equal(generateSteps(false, { random: () => 0 }), 500);
  assert.equal(generateSteps(false, { random: () => 0.999999 }), 3000);
  assert.equal(generateSteps(true, { random: () => 0 }), Math.floor(500 * 1.5));
  for (let i = 0; i < 100; i++) {
    const r = generateSteps(Math.random() < 0.5);
    assert.ok(r >= 500 && r <= 4500, `steps out of range: ${r}`);
  }
});

test("exploration v2: generateDistance range [0.3, 2.0] km x multiplier", () => {
  assert.equal(generateDistance(false, { random: () => 0 }), 0.3);
  const max = generateDistance(false, { random: () => 0.999999 });
  assert.ok(max >= 1.9 && max <= 2.0, `max distance should be near 2.0, got ${max}`);
  const vipMax = generateDistance(true, { random: () => 0.999999 });
  assert.ok(vipMax >= 2.8 && vipMax <= 3.0, `vip max should be near 3.0, got ${vipMax}`);
  for (let i = 0; i < 100; i++) {
    const r = generateDistance(Math.random() < 0.5);
    assert.ok(r >= 0.3 && r <= 3.0, `distance out of range: ${r}`);
  }
});
// === 9) JSON parsing ===
test("exploration v2: parseAnimalTraits / parseAnimalFunFacts fallback handling", () => {
  assert.deepEqual(parseAnimalTraits('["a","b"]'), ["a", "b"]);
  assert.deepEqual(parseAnimalTraits(""), []);
  assert.deepEqual(parseAnimalTraits(null), []);
  assert.deepEqual(parseAnimalTraits("not json"), []);
  assert.deepEqual(parseAnimalTraits('{"a":1}'), []);
  assert.deepEqual(parseAnimalTraits('["a", 1, null]'), ["a"]);
  assert.deepEqual(parseAnimalFunFacts('["a","b"]'), ["a", "b"]);
});

test("exploration v2: toKnowledgeSnapshot accepts both field-naming conventions", () => {
  const snake = toKnowledgeSnapshot({
    id: "persian-cat", species: "Persian", category: "cat",
    origin: "iran", lifespan: "12-17y", weight: "3-7 kg",
    traits: '["a"]', fun_facts: '["x","y"]', habitat: null, diet: null,
    conservation_status: null,
  });
  assert.ok(snake);
  assert.equal(snake.id, "persian-cat");
  assert.deepEqual(snake.traits, ["a"]);
  assert.deepEqual(snake.funFacts, ["x", "y"]);
  const camel = toKnowledgeSnapshot({
    id: "p", species: "s", category: "c",
    traits: "[]", funFacts: "[]",
  });
  assert.ok(camel);
  assert.equal(camel.id, "p");
  assert.equal(toKnowledgeSnapshot(null), null);
  assert.equal(toKnowledgeSnapshot(undefined), null);
  assert.equal(toKnowledgeSnapshot({ species: "x" }), null);
});

test("exploration v2: serializeResultData / deserializeResultData roundtrip", () => {
  const raw = serializeResultData({ title: "t", description: "d", emoji: "x", rarity: "rare", knowledgeId: "persian-cat" });
  const back = deserializeResultData(raw);
  assert.equal(back.title, "t");
  assert.equal(back.description, "d");
  assert.equal(back.emoji, "x");
  assert.equal(back.rarity, "rare");
  assert.equal(back.knowledgeId, "persian-cat");
  const d = deserializeResultData(null);
  assert.equal(d.rarity, "common");
  const d2 = deserializeResultData("not json");
  assert.equal(d2.rarity, "common");
  assert.equal(d2.title, "");
});

test("exploration v2: toEventResult sets isRare from rarity", () => {
  const common = toEventResult({ id: "x", petCategory: null, eventType: "postcard", title: "", description: "", imageEmoji: null, rarity: "common", weight: 1, requiredEquipment: null, knowledgeLink: null });
  assert.equal(common.isRare, false);
  const rare = toEventResult({ id: "x", petCategory: null, eventType: "postcard", title: "", description: "", imageEmoji: null, rarity: "rare", weight: 1, requiredEquipment: null, knowledgeLink: null });
  assert.equal(rare.isRare, true);
  const epic = toEventResult({ id: "x", petCategory: null, eventType: "postcard", title: "", description: "", imageEmoji: null, rarity: "epic", weight: 1, requiredEquipment: null, knowledgeLink: null });
  assert.equal(epic.isRare, true);
});

// === 10) API route files ===
test("exploration v2: 3 API route files exist and export the right functions", () => {
  const startPath = join(ROOT, "src/app/api/exploration/start/route.ts");
  const histPath = join(ROOT, "src/app/api/exploration/history/route.ts");
  const wikiPath = join(ROOT, "src/app/api/animal-wiki/[id]/route.ts");
  assert.ok(existsSync(startPath), `missing ${startPath}`);
  assert.ok(existsSync(histPath), `missing ${histPath}`);
  assert.ok(existsSync(wikiPath), `missing ${wikiPath}`);
  const startC = readFileSync(startPath, "utf8");
  const histC = readFileSync(histPath, "utf8");
  const wikiC = readFileSync(wikiPath, "utf8");
  assert.ok(startC.includes("export async function POST"), "start must export POST");
  assert.ok(histC.includes("export async function GET"), "history must export GET");
  assert.ok(wikiC.includes("export async function GET"), "animal-wiki must export GET");
  assert.ok(startC.includes("pickWeightedEvent"), "start must use pickWeightedEvent");
  assert.ok(startC.includes("getMaxExplorations"), "start must use getMaxExplorations");
  assert.ok(startC.includes("generateSteps") || startC.includes("getStepMultiplier"), "start must use step generator");
  assert.ok(startC.includes("EXPLORATION_LIMIT"), "start must return EXPLORATION_LIMIT");
  assert.ok(startC.includes("429"), "start must return 429 on limit");
  assert.ok(histC.includes("deserializeResultData"), "history must use deserializeResultData");
  assert.ok(wikiC.includes("toKnowledgeSnapshot"), "animal-wiki must use toKnowledgeSnapshot");
});
// === 11) i18n namespaces ===
test("exploration v2: messages.{zh,en}.json have explorationV2 / knowledge / api keys", () => {
  for (const locale of ["zh", "en"]) {
    const j = JSON.parse(readFileSync(join(ROOT, `messages/${locale}.json`), "utf8"));
    assert.ok(j.explorationV2, `${locale}.json missing explorationV2`);
    assert.ok(j.knowledge, `${locale}.json missing knowledge`);
    const e2 = j.explorationV2;
    for (const k of ["panelTitle", "timelineTitle", "remainingLabel", "startExplore", "freeExhausted", "vipExhausted", "upgradeHint", "viewKnowledge", "gotIt", "refreshHistory"]) {
      assert.ok(typeof e2[k] === "string" && e2[k].length > 0, `${locale}.explorationV2.${k} missing/empty`);
    }
    const kn = j.knowledge;
    for (const k of ["title", "origin", "lifespan", "weight", "habitat", "diet", "conservation", "funFactsTitle"]) {
      assert.ok(typeof kn[k] === "string" && kn[k].length > 0, `${locale}.knowledge.${k} missing/empty`);
    }
    assert.ok(j.api.explorationLimit, `${locale}.api.explorationLimit missing`);
    assert.ok(j.api.animalWikiNotFound, `${locale}.api.animalWikiNotFound missing`);
    assert.ok(j.api.animalWikiLoadFailed, `${locale}.api.animalWikiLoadFailed missing`);
    assert.ok(j.api.explorationStartFailed, `${locale}.api.explorationStartFailed missing`);
  }
});

// === 12) Frontend component files ===
test("exploration v2: 5 frontend components exist with required exports / testids", () => {
  const files = [
    ["explore-button.tsx", "ExploreButton", "explore-button-trigger"],
    ["explore-result-modal.tsx", "ExploreResultModal", "explore-result-modal"],
    ["knowledge-card.tsx", "KnowledgeCard", "knowledge-card"],
    ["pet-timeline.tsx", "PetTimeline", "pet-timeline"],
    ["explore-v2-panel.tsx", "ExploreV2Panel", "explore-v2-panel"],
  ];
  for (const [f, sym, testid] of files) {
    const p = join(ROOT, `src/components/exploration-v2/${f}`);
    assert.ok(existsSync(p), `missing ${p}`);
    const c = readFileSync(p, "utf8");
    assert.ok(c.includes(`export function ${sym}`), `${f} must export ${sym}`);
    assert.ok(c.includes(testid), `${f} must contain data-testid="${testid}"`);
  }
});

// === 13) Page file ===
test("exploration v2: /[locale]/explore-v2/page.tsx renders client panel (auth moved client-side)", () => {
  const p = join(ROOT, "src/app/[locale]/explore-v2/page.tsx");
  assert.ok(existsSync(p), `missing ${p}`);
  const c = readFileSync(p, "utf8");
  assert.ok(c.includes("ExploreV2Panel"), "page must render ExploreV2Panel");
  // 2026-09 修复「已登录仍提示请先登录」：登录 token 只存 localStorage（API 走 Bearer），
  // cookie 中并不存在令牌；SSR 读 cookie 鉴权永远拿到 null → 已登录用户也被误拦。
  // 因此鉴权必须在客户端（面板 + /api/exploration/quota）完成，
  // 页面不得再从 cookie / verifyToken 判定登录态（详见 explore-auth-repair.test.mjs）。
  assert.ok(!c.includes("cookieStore"), "page must NOT gate on cookies (token lives in localStorage)");
  assert.ok(!c.includes("verifyToken"), "page must NOT verify token server-side (client bootstraps auth)");
});

// === 14) Constants invariants ===
test("exploration v2: EVENT_TYPES / RARITY_LEVELS invariants", () => {
  assert.equal(EVENT_TYPES.length, 5);
  for (const t of ["postcard", "gift", "knowledge", "encounter", "rest"]) {
    assert.ok(EVENT_TYPES.includes(t), `EVENT_TYPES missing ${t}`);
  }
  assert.equal(RARITY_LEVELS.length, 3);
  const allRarities = ["common", "rare", "epic"];
  for (const r of allRarities) {
    assert.ok(RARITY_LEVELS.includes(r), `RARITY_LEVELS missing ${r}`);
  }
  for (const r of allRarities) {
    const event = { id: r, petCategory: null, eventType: "postcard", title: "", description: "", imageEmoji: null, rarity: r, weight: 1, requiredEquipment: null, knowledgeLink: null };
    const out = toEventResult(event);
    assert.equal(out.rarity, r);
  }
});

// === 15) SiteHeader has new nav entry ===
test("exploration v2: SiteHeader includes /explore-v2 nav item", () => {
  const c = readFileSync(join(ROOT, "src/components/layout/SiteHeader.tsx"), "utf8");
  assert.ok(c.includes("/explore-v2"), "SiteHeader must link /explore-v2");
  assert.ok(c.includes("navExplore") || c.includes("t(\"explore\")"), "SiteHeader must use navExplore label");
});

// === 16) DDL auto-execute: SCHEMA_CREATES has 3 table DDLs (verified earlier but with stricter key) ===
test("exploration v2: SCHEMA_CREATES has animal_wiki / exploration_events / exploration_records CREATE TABLE", () => {
  const c = readFileSync(join(ROOT, "src/db/client.ts"), "utf8");
  assert.ok(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"animal_wiki"/.test(c), 'SCHEMA_CREATES missing animal_wiki DDL');
  assert.ok(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"exploration_events"/.test(c), 'SCHEMA_CREATES missing exploration_events DDL');
  assert.ok(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"exploration_records"/.test(c), 'SCHEMA_CREATES missing exploration_records DDL');
});

// === 17) DDL auto-execute: SCHEMA_CREATES has seed INSERTs for animal_wiki + exploration_events ===
test("exploration v2: SCHEMA_CREATES contains seed INSERTs (animal_wiki + exploration_events)", () => {
  const c = readFileSync(join(ROOT, "src/db/client.ts"), "utf8");
  // animal_wiki seed (persian cat)
  const m1 = c.match(/INSERT\s+INTO\s+"animal_wiki"[\s\S]+?ON\s+CONFLICT\s*\("id"\)\s*DO\s+NOTHING/);
  assert.ok(m1, "SCHEMA_CREATES missing animal_wiki INSERT seed");
  assert.ok(m1[0].includes("persian-cat"), "animal_wiki seed must include persian-cat");
  assert.ok(m1[0].includes("12-17年"), "animal_wiki seed must include lifespan 12-17年");
  // exploration_events seed (20 rows)
  const m2 = c.match(/INSERT\s+INTO\s+"exploration_events"[\s\S]+?ON\s+CONFLICT\s*\("id"\)\s*DO\s+NOTHING/);
  assert.ok(m2, "SCHEMA_CREATES missing exploration_events INSERT seed");
  const evtMatches = m2[0].match(/\('evt-\d{3}'/g) || [];
  assert.ok(evtMatches.length >= 20, `exploration_events seed should have >=20 rows, got ${evtMatches.length}`);
});

// === 18) SiteHeader uses navExplore i18n key (not the old 'explore') ===
test("exploration v2: SiteHeader nav item uses navExplore i18n key", () => {
  const c = readFileSync(join(ROOT, "src/components/layout/SiteHeader.tsx"), "utf8");
  assert.ok(/t\(\s*"navExplore"\s*\)/.test(c), 'SiteHeader must call t("navExplore")');
  // Should not use the bare 'explore' for the explore-v2 entry
  const exploreV2Line = c.split(/\r?\n/).find((l) => l.includes("/explore-v2"));
  assert.ok(exploreV2Line, "no nav line for /explore-v2 found");
  assert.ok(!/t\(\s*"explore"\s*\)/.test(exploreV2Line), "explore-v2 nav line must not use old 'explore' key");
});

// === 19) navExplore key exists in both locales with correct values ===
test("exploration v2: messages.{zh,en}.json nav.navExplore = 🗺️ 探索 / 🗺️ Explore", () => {
  for (const [f, expected] of [
    [join(ROOT, "messages/zh.json"), "🗺️ 探索"],
    [join(ROOT, "messages/en.json"), "🗺️ Explore"],
  ]) {
    const j = JSON.parse(readFileSync(f, "utf8"));
    assert.ok(j.nav && typeof j.nav.navExplore === "string", `${f} missing nav.navExplore`);
    assert.equal(j.nav.navExplore, expected, `${f} nav.navExplore should be "${expected}", got "${j.nav.navExplore}"`);
  }
});

// === 20) Mobile hamburger also exposes /explore-v2 (via same items array) ===
test("exploration v2: mobile menu renders /explore-v2 (same items array)", () => {
  const c = readFileSync(join(ROOT, "src/components/layout/SiteHeader.tsx"), "utf8");
  // Find the items array + ensure it appears in mobile section too (no separate copy)
  const itemsIdx = c.indexOf("const items = [");
  const mobileIdx = c.indexOf("md:hidden");
  assert.ok(itemsIdx > 0, "items array must exist");
  assert.ok(mobileIdx > 0, "mobile menu section must exist");
  // Both desktop <nav> and mobile <nav> render items.map(...)
  const mapCount = (c.match(/items\.map\(/g) || []).length;
  assert.ok(mapCount >= 2, "items.map should be used in both desktop and mobile (>=2 occurrences)");
  // The /explore-v2 entry should appear in the items array
  assert.ok(c.includes('"/explore-v2"'), "items array must contain /explore-v2");
});
