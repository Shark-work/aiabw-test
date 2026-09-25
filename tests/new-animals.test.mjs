/**
 * 新宠物数据回归测试（垂耳兔 lop-rabbit + 玄凤鹦鹉 cockatiel，roadmap 任务一）
 *
 * 数据驱动设计：百科 (animal_wiki) + 探索事件库 (exploration_events) 的种子数据
 * 直接写在 src/db/client.ts 的 SCHEMA_CREATES 中，启动时幂等落库（SCHEMA_VERSION 闸门）。
 * 本文件验证：
 *   1) 宠物数据完整性：两个新物种的百科 seed（字段、JSON traits/fun_facts 可解析）
 *   2) 探索事件：evt-041~060 共 20 条（5 类型 / 3 稀有度 / id 无冲突 / 表情占位齐全）
 *   3) 物种特性：垂耳兔食材类 gift（额外掉落食材）、玄凤鹦鹉 rare+epic 占比（高空视野→稀有事件）
 *   4) knowledge 事件的 knowledge_link 指向存在的百科 id（类别一致）
 *   5) 对话语料：messages/{zh,en}.json newPets 命名空间（人设台词 / 互动动作 / 解锁说明 / 立绘占位）
 *   6) 成就联动：探险新手→垂耳兔、奇遇猎人→玄凤鹦鹉、百科达人 5 物种可达、SCHEMA_VERSION>=3
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientSrc = readFileSync(join(ROOT, "src/db/client.ts"), "utf8");
const zh = JSON.parse(readFileSync(join(ROOT, "messages/zh.json"), "utf8"));
const en = JSON.parse(readFileSync(join(ROOT, "messages/en.json"), "utf8"));
const achSrc = readFileSync(join(ROOT, "src/lib/achievements-config.ts"), "utf8");

/** 按 INSERT ... ON CONFLICT 边界切出所有 seed 块，避免跨块吞并 */
function seedBlocks(table) {
  const re = new RegExp(
    `INSERT\\s+INTO\\s+"${table}"[\\s\\S]+?ON\\s+CONFLICT\\s*\\("id"\\)\\s*DO\\s+NOTHING`,
    "g",
  );
  return clientSrc.match(re) ?? [];
}

/** 提取新宠物百科 seed 块（含 lop-rabbit 的 INSERT ... ON CONFLICT 块） */
function wikiSeedBlock() {
  const block = seedBlocks("animal_wiki").find((b) => b.includes("lop-rabbit"));
  assert.ok(block, "client.ts missing animal_wiki seed block for lop-rabbit/cockatiel");
  return block;
}

/** 提取新事件 seed 块（evt-041 起的 INSERT ... ON CONFLICT 块） */
function eventsSeedBlock() {
  const block = seedBlocks("exploration_events").find((b) => b.includes("evt-041"));
  assert.ok(block, "client.ts missing exploration_events seed block for evt-041+");
  return block;
}

/** 解析事件行：('evt-041','rabbit','postcard','标题','描述','🌼','common',25,NULL|'wiki-id') */
const ROW_RE =
  /\('evt-(\d{3})','(\w+)','(\w+)','([^']*)','([^']*)','([^']*)','(common|rare|epic)',(\d+),(NULL|'[a-z-]+')\)/g;

function eventRows() {
  return [...eventsSeedBlock().matchAll(ROW_RE)].map((m) => ({
    id: m[1],
    category: m[2],
    type: m[3],
    title: m[4],
    desc: m[5],
    emoji: m[6],
    rarity: m[7],
    weight: Number(m[8]),
    link: m[9] === "NULL" ? null : m[9].slice(1, -1),
  }));
}

// === 1) 宠物数据完整性 =====================================================

test("new animals: animal_wiki seed contains lop-rabbit and cockatiel rows", () => {
  const block = wikiSeedBlock();
  assert.ok(block.includes("'lop-rabbit'"), "wiki seed missing lop-rabbit id");
  assert.ok(block.includes("'cockatiel'"), "wiki seed missing cockatiel id");
  assert.ok(block.includes("垂耳兔 / Lop Rabbit"), "lop-rabbit species name missing");
  assert.ok(block.includes("玄凤鹦鹉 / Cockatiel"), "cockatiel species name missing");
  assert.ok(block.includes("'兔'"), "lop-rabbit category missing");
  assert.ok(block.includes("'鹦鹉'"), "cockatiel category missing");
  assert.ok(block.includes("7-10年"), "lop-rabbit lifespan missing");
  assert.ok(block.includes("15-20年"), "cockatiel lifespan missing");
  assert.ok(block.includes("提摩西草"), "lop-rabbit diet (hay staple) missing");
  assert.ok(block.includes("草籽"), "cockatiel diet (seeds) missing");
});

test("new animals: wiki traits / fun_facts are valid JSON arrays (5 fun facts each)", () => {
  const block = wikiSeedBlock();
  const jsonLiterals = block.match(/'\[\\?"[^\]]+?\]'/g) ?? [];
  // 至少两个物种 × (traits + fun_facts) = 4 个 JSON 数组
  assert.ok(jsonLiterals.length >= 4, `expected >=4 JSON literals, got ${jsonLiterals.length}`);
  for (const lit of jsonLiterals) {
    const inner = lit.slice(1, -1);
    const parsed = JSON.parse(inner);
    assert.ok(Array.isArray(parsed) && parsed.length > 0, `not a non-empty array: ${inner.slice(0, 40)}`);
    for (const item of parsed) {
      assert.equal(typeof item, "string", "array items must be strings");
    }
  }
  // 每个物种 fun_facts 恰好 5 条（fun_facts 各含物种名，traits 不含 → 精确筛出各 1 条）
  for (const name of ["垂耳兔", "玄凤鹦鹉"]) {
    const hits = jsonLiterals.filter((l) => l.includes(name));
    assert.equal(hits.length, 1, `${name} should have exactly 1 fun_facts array`);
    assert.equal(JSON.parse(hits[0].slice(1, -1)).length, 5, `${name} fun_facts should have 5 entries`);
  }
});

// === 2) 探索事件（evt-041~060） ===========================================

test("new animals: evt-041~evt-060 seed has 20 events with no id conflicts", () => {
  const block = eventsSeedBlock();
  const ids = [...block.matchAll(/\('evt-(\d{3})'/g)].map((m) => m[1]);
  assert.equal(ids.length, 20, `expected 20 new events, got ${ids.length}`);
  assert.deepEqual(ids, Array.from({ length: 20 }, (_, i) => String(i + 41).padStart(3, "0")));
  for (const n of ids) {
    assert.ok(Number(n) > 40, `evt-${n} conflicts with legacy events`);
  }
  // 行级解析与原始计数一致（无漏解析行）
  assert.equal(eventRows().length, 20, "row parser should cover all 20 rows");
});

test("new animals: new events cover 5 types / 3 rarities, all with emoji placeholder", () => {
  const rows = eventRows();
  const types = new Set(rows.map((r) => r.type));
  for (const t of ["postcard", "gift", "knowledge", "encounter", "rest"]) {
    assert.ok(types.has(t), `event type ${t} not covered`);
  }
  const rarities = new Set(rows.map((r) => r.rarity));
  for (const r of ["common", "rare", "epic"]) {
    assert.ok(rarities.has(r), `rarity ${r} not covered`);
  }
  const categories = new Set(rows.map((r) => r.category));
  assert.deepEqual([...categories].sort(), ["bird", "rabbit"]);
  // 立绘/表情占位：每条事件必须有 image_emoji（后续替换正式素材前的展示保障）
  for (const r of rows) {
    assert.ok(r.emoji.length > 0, `${r.id} missing image_emoji placeholder`);
    assert.ok(r.title.length > 0 && r.desc.length >= 10, `${r.id} title/desc too short`);
    assert.ok(r.weight >= 1 && r.weight <= 30, `${r.id} weight out of expected range`);
  }
});

// === 3) 物种探索特性 =======================================================

test("new animals: lop rabbit has food-themed gift events (额外掉落食材特性)", () => {
  const rows = eventRows().filter((r) => r.category === "rabbit");
  assert.equal(rows.length, 10, "rabbit should have 10 events (evt-041~050)");
  const gifts = rows.filter((r) => r.type === "gift");
  assert.ok(gifts.length >= 3, `rabbit gift events >= 3 (food drops), got ${gifts.length}`);
  const foodHits = gifts.filter((r) => /胡萝卜|野莓|野菜|浆果/.test(r.title + r.desc));
  assert.ok(foodHits.length >= 3, `rabbit food-themed gifts >= 3, got ${foodHits.length}`);
});

test("new animals: cockatiel skews rare/epic (高空视野→稀有事件特性)", () => {
  const rows = eventRows().filter((r) => r.category === "bird");
  assert.equal(rows.length, 10, "bird should have 10 events (evt-051~060)");
  const rarePlus = rows.filter((r) => r.rarity !== "common");
  assert.ok(rarePlus.length >= 5, `bird rare+epic events >= 5, got ${rarePlus.length}`);
  // 空中奇遇 / 远山宝藏两条标志性稀有事件
  const evt57 = rows.find((r) => r.id === "057");
  assert.ok(evt57 && /高空|热气球/.test(evt57.title + evt57.desc), "evt-057 空中奇遇 missing");
  assert.equal(evt57.rarity, "rare");
  const evt60 = rows.find((r) => r.id === "060");
  assert.ok(evt60 && /远山|宝藏/.test(evt60.title + evt60.desc), "evt-060 远山宝藏 missing");
  assert.equal(evt60.rarity, "epic");
});

test("new animals: knowledge events link to new wiki ids (category-consistent)", () => {
  const knowledge = eventRows().filter((r) => r.type === "knowledge");
  assert.equal(knowledge.length, 4, "expected 4 knowledge events");
  const block = wikiSeedBlock();
  for (const r of knowledge) {
    assert.ok(r.link, `${r.id} knowledge event must have knowledge_link`);
    assert.ok(block.includes(`'${r.link}'`), `knowledge link ${r.link} not in wiki seed`);
    if (r.category === "rabbit") assert.equal(r.link, "lop-rabbit", `${r.id} must link lop-rabbit`);
    if (r.category === "bird") assert.equal(r.link, "cockatiel", `${r.id} must link cockatiel`);
  }
  // 非 knowledge 事件不得携带 knowledge_link
  for (const r of eventRows().filter((r) => r.type !== "knowledge")) {
    assert.equal(r.link, null, `${r.id} non-knowledge event must not have knowledge_link`);
  }
});

// === 4) 幂等与版本闸门 =====================================================

test("new animals: all new seed INSERTs are idempotent; SCHEMA_VERSION bumped", () => {
  assert.ok(/lop-rabbit[\s\S]+?cockatiel[\s\S]+?ON\s+CONFLICT\s*\("id"\)\s*DO\s+NOTHING/.test(clientSrc));
  assert.ok(/evt-041[\s\S]+?evt-060[\s\S]+?ON\s+CONFLICT\s*\("id"\)\s*DO\s+NOTHING/.test(clientSrc));
  // 种子变更必须提升版本闸门，否则生产库不同步
  const m = clientSrc.match(/SCHEMA_VERSION\s*=\s*(\d+)/);
  assert.ok(m, "SCHEMA_VERSION const exists");
  assert.ok(Number(m[1]) >= 3, `SCHEMA_VERSION must be >= 3 (got ${m[1]})`);
});

// === 5) 对话语料（i18n newPets） ==========================================

function assertCorpus(np, locale) {
  for (const key of ["lopRabbit", "cockatiel"]) {
    const sp = np[key];
    assert.ok(sp, `${locale} newPets.${key} missing`);
    assert.ok(sp.name && sp.persona && sp.unlock, `${locale} ${key} name/persona/unlock missing`);
    assert.ok(sp.avatarEmoji, `${locale} ${key} avatarEmoji placeholder missing`);
    assert.ok(
      Array.isArray(sp.interactions) && sp.interactions.length === 4,
      `${locale} ${key} should have 4 interactions`,
    );
    assert.ok(Array.isArray(sp.lines), `${locale} ${key} lines must be an array`);
    assert.ok(
      sp.lines.length >= 10 && sp.lines.length <= 15,
      `${locale} ${key} lines should be 10-15, got ${sp.lines.length}`,
    );
    for (const line of sp.lines) {
      assert.equal(typeof line, "string");
      assert.ok(line.trim().length >= 8, `${locale} ${key} line too short: ${line}`);
    }
  }
}

test("new animals: zh corpus complete (人设台词 + 互动动作 + 解锁说明)", () => {
  const np = zh.newPets;
  assert.ok(np, "zh.json missing newPets namespace");
  assertCorpus(np, "zh");
  assert.equal(np.lopRabbit.avatarEmoji, "🐰");
  assert.equal(np.cockatiel.avatarEmoji, "🦜");
  // 人设关键词：垂耳兔（耳朵/胡萝卜）；玄凤鹦鹉（模仿/好奇/口哨/肩膀）
  assert.ok(/耳朵|跺脚/.test(np.lopRabbit.persona), "lopRabbit persona keywords");
  const rabbitAll = np.lopRabbit.lines.join("\n");
  assert.ok(/耳朵/.test(rabbitAll) && /胡萝卜/.test(rabbitAll), "rabbit lines should mention ears & carrot");
  assert.ok(/模仿|好奇心/.test(np.cockatiel.persona), "cockatiel persona keywords");
  const birdAll = np.cockatiel.lines.join("\n");
  assert.ok(/口哨/.test(birdAll) && /肩膀/.test(birdAll), "cockatiel lines should mention whistle & shoulder");
  // 互动动作与人设一致
  assert.deepEqual(np.lopRabbit.interactions, ["蹭手", "竖耳倾听", "蹦跳", "缩成一团睡觉"]);
  assert.deepEqual(np.cockatiel.interactions, ["歪头杀", "展翅", "吹口哨", "站肩膀"]);
  // 解锁说明与成就联动
  assert.ok(np.lopRabbit.unlock.includes("探险新手"), "lopRabbit unlock should mention 探险新手");
  assert.ok(np.cockatiel.unlock.includes("奇遇猎人"), "cockatiel unlock should mention 奇遇猎人");
});

test("new animals: en corpus complete and line counts match zh", () => {
  const np = en.newPets;
  assert.ok(np, "en.json missing newPets namespace");
  assertCorpus(np, "en");
  assert.equal(np.lopRabbit.lines.length, zh.newPets.lopRabbit.lines.length, "lopRabbit zh/en line parity");
  assert.equal(np.cockatiel.lines.length, zh.newPets.cockatiel.lines.length, "cockatiel zh/en line parity");
  const rabbitAll = np.lopRabbit.lines.join("\n");
  assert.ok(/ear/i.test(rabbitAll) && /carrot/i.test(rabbitAll), "en rabbit lines should mention ears & carrot");
  const birdAll = np.cockatiel.lines.join("\n");
  assert.ok(/whistle/i.test(birdAll), "en cockatiel lines should mention whistle");
  assert.ok(/mimic/i.test(birdAll) || /mimic/i.test(np.cockatiel.persona), "en cockatiel should mention mimicking");
  // 双语合计语料条数（每物种 10-15 × 2 语言 × 2 物种 → 40~60）
  const total =
    zh.newPets.lopRabbit.lines.length + zh.newPets.cockatiel.lines.length +
    en.newPets.lopRabbit.lines.length + en.newPets.cockatiel.lines.length;
  assert.ok(total >= 40 && total <= 60, `total corpus lines should be 40-60, got ${total}`);
});

// === 6) 成就系统联动 =======================================================

test("new animals: achievement linkage (explorer-10→垂耳兔 / all-rare-events→玄凤鹦鹉 / wiki 5 可达)", () => {
  // 徽章奖励关联（achievements-config REWARD_NOTE_BADGES，任务二落地）
  assert.ok(/"explorer-10",\s*\/\/ 垂耳兔解锁资格/.test(achSrc), "explorer-10 must grant 垂耳兔 unlock");
  assert.ok(/"all-rare-events",\s*\/\/ 玄凤鹦鹉解锁资格/.test(achSrc), "all-rare-events must grant 玄凤鹦鹉 unlock");
  // 徽章 i18n 奖励说明（zh/en）
  assert.ok(zh.achievements.badges.explorer10.rewardNote.includes("垂耳兔"), "zh explorer10 rewardNote");
  assert.ok(zh.achievements.badges.allRareEvents.rewardNote.includes("玄凤鹦鹉"), "zh allRareEvents rewardNote");
  assert.ok(en.achievements.badges.explorer10.rewardNote.includes("Lop Bunny"), "en explorer10 rewardNote");
  assert.ok(en.achievements.badges.allRareEvents.rewardNote.includes("Cockatiel"), "en allRareEvents rewardNote");
  // 百科达人 target=5 且 5 个物种 id 全部存在于 wiki seed（解锁条件可达）
  assert.ok(
    /\{ id: "wiki-collector", emoji: "📚", rewardPoints: 15, target: 5/.test(achSrc),
    "wiki-collector target must be 5",
  );
  const wikiIds = seedBlocks("animal_wiki").flatMap((b) =>
    [...b.matchAll(/\(\s*'([a-z-]+)',\s*\r?\n?\s*'[^'\r\n]+ \/ [^'\r\n]+',/g)].map((m) => m[1]),
  );
  for (const id of ["persian-cat", "red-fox", "shiba-inu", "lop-rabbit", "cockatiel"]) {
    assert.ok(wikiIds.includes(id), `wiki seed missing ${id} (百科达人 5/5)`);
  }
  assert.ok(wikiIds.length >= 5, `wiki species count >= 5, got ${wikiIds.length}`);
});
