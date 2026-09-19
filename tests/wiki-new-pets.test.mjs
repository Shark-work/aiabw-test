/**
 * 新宠物数据回归测试（赤狐 red-fox + 柴犬 shiba-inu）
 *
 * 数据驱动设计：百科 (animal_wiki) + 探索事件库 (exploration_events) 的种子数据
 * 直接写在 src/db/client.ts 的 SCHEMA_CREATES 中，启动时幂等落库。
 * 本文件验证：
 *   1) 两个新物种的百科 seed 完整（字段、JSON traits/fun_facts 可解析）
 *   2) evt-021~evt-040 共 20 条新事件（5 类型 / 3 稀有度齐全 / id 不与旧事件冲突）
 *   3) knowledge 类事件的 knowledge_link 指向存在的百科 id
 *   4) 所有新 INSERT 均带 ON CONFLICT ("id") DO NOTHING（幂等）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientSrc = readFileSync(join(ROOT, "src/db/client.ts"), "utf8");

/** 按 INSERT ... ON CONFLICT 边界切出所有 seed 块，避免跨块吞并 */
function seedBlocks(table) {
  const re = new RegExp(
    `INSERT\\s+INTO\\s+"${table}"[\\s\\S]+?ON\\s+CONFLICT\\s*\\("id"\\)\\s*DO\\s+NOTHING`,
    "g",
  );
  return clientSrc.match(re) ?? [];
}

/** 提取新宠物百科 seed 块（含 red-fox 的 INSERT ... ON CONFLICT 块） */
function wikiSeedBlock() {
  const block = seedBlocks("animal_wiki").find((b) => b.includes("red-fox"));
  assert.ok(block, "client.ts missing animal_wiki seed block for red-fox/shiba-inu");
  return block;
}

/** 提取新事件 seed 块（evt-021 起的 INSERT ... ON CONFLICT 块） */
function eventsSeedBlock() {
  const block = seedBlocks("exploration_events").find((b) => b.includes("evt-021"));
  assert.ok(block, "client.ts missing exploration_events seed block for evt-021+");
  return block;
}

test("new pets: animal_wiki seed contains red-fox and shiba-inu rows", () => {
  const block = wikiSeedBlock();
  assert.ok(block.includes("'red-fox'"), "wiki seed missing red-fox id");
  assert.ok(block.includes("'shiba-inu'"), "wiki seed missing shiba-inu id");
  assert.ok(block.includes("赤狐 / Red Fox"), "red-fox species name missing");
  assert.ok(block.includes("柴犬 / Shiba Inu"), "shiba-inu species name missing");
  assert.ok(block.includes("12-15年"), "shiba-inu lifespan missing");
  assert.ok(block.includes("无危（LC"), "red-fox conservation status missing");
});

test("new pets: wiki traits / fun_facts are valid JSON arrays", () => {
  const block = wikiSeedBlock();
  // seed 中 JSON 字符串以 '["..."]' 形式内联，逐一提取解析
  const jsonLiterals = block.match(/'\[\\?"[^\]]+?\]'/g) ?? [];
  // 至少两个物种 × (traits + fun_facts) = 4 个 JSON 数组
  assert.ok(jsonLiterals.length >= 4, `expected >=4 JSON literals, got ${jsonLiterals.length}`);
  for (const lit of jsonLiterals) {
    const inner = lit.slice(1, -1); // 去掉外层单引号
    const parsed = JSON.parse(inner);
    assert.ok(Array.isArray(parsed) && parsed.length > 0, `not a non-empty array: ${inner.slice(0, 40)}`);
    for (const item of parsed) {
      assert.equal(typeof item, "string", "array items must be strings");
    }
  }
  // 每个物种 fun_facts 恰好 5 条（与设计一致）
  const funFactBlocks = jsonLiterals.filter((l) => l.includes("赤狐") || l.includes("柴犬"));
  assert.equal(funFactBlocks.length, 2, "should have exactly 2 fun_facts arrays");
  for (const l of funFactBlocks) {
    assert.equal(JSON.parse(l.slice(1, -1)).length, 5, "fun_facts should have 5 entries");
  }
});

test("new pets: evt-021~evt-040 seed has 20 events with no id conflicts", () => {
  const block = eventsSeedBlock();
  const ids = [...block.matchAll(/\('evt-(\d{3})'/g)].map((m) => m[1]);
  assert.equal(ids.length, 20, `expected 20 new events, got ${ids.length}`);
  // 连续编号 021..040
  assert.deepEqual(ids, Array.from({ length: 20 }, (_, i) => String(i + 21).padStart(3, "0")));
  // 与旧事件（001~020）无重叠
  for (const n of ids) {
    assert.ok(Number(n) > 20, `evt-${n} conflicts with legacy events`);
  }
});

test("new pets: new events cover 5 types and 3 rarities", () => {
  const block = eventsSeedBlock();
  const rows = [...block.matchAll(/\('evt-\d{3}','(\w+)'?,?'(\w+)'/g)];
  // 按列位置解析：('evt-021','fox','postcard',...,'rare',10,...)
  const parsed = [...block.matchAll(/\('evt-(\d{3})','(\w+)','(\w+)'/g)].map((m) => ({
    id: m[1],
    category: m[2],
    type: m[3],
  }));
  assert.equal(parsed.length, 20);
  const types = new Set(parsed.map((r) => r.type));
  for (const t of ["postcard", "gift", "knowledge", "encounter", "rest"]) {
    assert.ok(types.has(t), `event type ${t} not covered`);
  }
  const categories = new Set(parsed.map((r) => r.category));
  assert.deepEqual([...categories].sort(), ["dog", "fox"]);
  // 稀有度
  const rarities = [...block.matchAll(/'(common|rare|epic)',\d+,/g)];
  assert.equal(rarities.length, 20);
  for (const r of ["common", "rare", "epic"]) {
    assert.ok(rarities.some((x) => x.includes(r)), `rarity ${r} not covered`);
  }
  assert.ok(rows.length >= 20, "row shape sanity check");
});

test("new pets: knowledge events link to existing wiki ids", () => {
  const block = eventsSeedBlock();
  const knowledgeRows = [...block.matchAll(/\('evt-(\d{3})','(\w+)','knowledge',[\s\S]*?'(red-fox|shiba-inu)'\)/g)];
  assert.equal(knowledgeRows.length, 4, "expected 4 knowledge events with wiki links");
  for (const [, evtId, category, link] of knowledgeRows) {
    // 链接目标必须在 wiki seed 中定义
    assert.ok(wikiSeedBlock().includes(`'${link}'`), `knowledge link ${link} not in wiki seed`);
    // fox 类事件只能链 red-fox，dog 类只能链 shiba-inu（类别一致）
    if (category === "fox") assert.equal(link, "red-fox", `evt-${evtId} fox event must link red-fox`);
    if (category === "dog") assert.equal(link, "shiba-inu", `evt-${evtId} dog event must link shiba-inu`);
  }
});

test("new pets: all new seed INSERTs are idempotent (ON CONFLICT DO NOTHING)", () => {
  assert.ok(/red-fox[\s\S]+?shiba-inu[\s\S]+?ON\s+CONFLICT\s*\("id"\)\s*DO\s+NOTHING/.test(clientSrc));
  assert.ok(/evt-021[\s\S]+?evt-040[\s\S]+?ON\s+CONFLICT\s*\("id"\)\s*DO\s+NOTHING/.test(clientSrc));
});
