/**
 * 契约测试：艾比平台 Phase 3 —— 目录种子（指令集 3.1~3.5，2026-09-30）
 * 运行：node --experimental-strip-types --test tests/aibi-catalog.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AIBI_RARITIES,
  AIBI_HABITATS,
  AIBI_SPECIES,
  AIBI_PACKS,
  AIBI_ITEMS,
  AIBI_RARITY_IDS,
  AIBI_HABITAT_IDS,
  speciesPoolForPack,
} from "../src/lib/aibi-catalog.ts";
import { buildAibiCatalogSeedSql, AIBI_CATALOG_SEED_COUNT } from "../src/db/aibi-catalog-seed.ts";

const migration = readFileSync(new URL("../drizzle/0026_aibi_catalog.sql", import.meta.url), "utf8");
const client = readFileSync(new URL("../src/db/client.ts", import.meta.url), "utf8");
const seedScript = readFileSync(new URL("../scripts/seed-aibi-catalog.ts", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// ============ 3.1 稀有度（5 个，文档逐项） ============
test("rarities: 5 档与文档颜色/倍率完全一致", () => {
  assert.equal(AIBI_RARITIES.length, 5);
  const byId = Object.fromEntries(AIBI_RARITIES.map((r) => [r.id, r]));
  assert.deepEqual(AIBI_RARITY_IDS, ["common", "rare", "epic", "legendary", "mythic"], "稀有度档位与排序");
  assert.equal(byId.common.nameZh, "普通");
  assert.equal(byId.common.color.toUpperCase(), "#9EAEB8");
  assert.equal(byId.common.multiplier, 1);
  assert.equal(byId.rare.nameZh, "稀有");
  assert.equal(byId.rare.color, "#4A90D9");
  assert.equal(byId.rare.multiplier, 1.5);
  assert.equal(byId.epic.nameZh, "史诗");
  assert.equal(byId.epic.color, "#9B59B6");
  assert.equal(byId.epic.multiplier, 2);
  assert.equal(byId.legendary.nameZh, "传说");
  assert.equal(byId.legendary.color, "#F39C12");
  assert.equal(byId.legendary.multiplier, 3);
  assert.equal(byId.mythic.nameZh, "神话");
  assert.equal(byId.mythic.color, "#E74C3C");
  assert.equal(byId.mythic.multiplier, 5);
});

// ============ 3.2 栖息地（5 个） ============
test("habitats: 5 个与元素倾向/描述一致", () => {
  assert.equal(AIBI_HABITATS.length, 5);
  assert.deepEqual(AIBI_HABITAT_IDS, ["mistwood", "lavaforge", "frostshore", "mechwaste", "skyisles"]);
  const byId = Object.fromEntries(AIBI_HABITATS.map((h) => [h.id, h]));
  assert.deepEqual([byId.mistwood.nameZh, byId.mistwood.elementAffinity], ["星雾森林", "自然/暗"]);
  assert.deepEqual([byId.lavaforge.nameZh, byId.lavaforge.elementAffinity], ["熔岩裂谷", "火/岩"]);
  assert.deepEqual([byId.frostshore.nameZh, byId.frostshore.elementAffinity], ["冰晶海岸", "冰/水"]);
  assert.deepEqual([byId.mechwaste.nameZh, byId.mechwaste.elementAffinity], ["机械废都", "雷/钢"]);
  assert.deepEqual([byId.skyisles.nameZh, byId.skyisles.elementAffinity], ["云端群岛", "风/光"]);
  for (const h of AIBI_HABITATS) {
    assert.ok(h.description.length > 0 && h.descriptionEn.length > 0, `${h.id} 双语描述`);
  }
});

// ============ 3.3 物种（12 个，文档逐项字段） ============
test("species: 12 个与文档属性逐项一致", () => {
  assert.equal(AIBI_SPECIES.length, 12);
  const byId = Object.fromEntries(AIBI_SPECIES.map((s) => [s.id, s]));
  const expect = {
    // 2026-10-06：supportsChat 全物种置 false（聊天能力未上线、无任何代码路径消费，
    // 消除能力开关空转造成的用户预期落差；schema 字段保留，方案 a 排期见 backlog）
    "mist-fox": ["雾尾狐", "rare", "自然", "mistwood", "傲娇型", 2, false, false],
    "pyro-dragon": ["炎鳞龙", "legendary", "火", "lavaforge", "高冷型", 4, true, false],
    "frost-bird": ["冰羽鸟", "epic", "冰", "frostshore", "活泼型", 3, false, false],
    "steel-beast": ["钢甲兽", "rare", "雷", "mechwaste", "调皮型", 2, false, false],
    "light-butterfly": ["光翼蝶", "mythic", "光", "skyisles", "神秘型", 5, true, false],
    "moss-turtle": ["苔甲龟", "common", "自然", "mistwood", "温顺型", 1, false, false],
    "magma-monkey": ["熔核猴", "common", "火", "lavaforge", "活泼型", 1, false, false],
    "frost-wolf": ["霜狼", "rare", "冰", "frostshore", "守护型", 2, false, false],
    "volt-snake": ["电蛇", "epic", "雷", "mechwaste", "好奇型", 3, false, false],
    "wind-spirit": ["风灵", "legendary", "风", "skyisles", "神秘型", 4, true, false],
    "rock-beetle": ["岩甲虫", "common", "岩", "mechwaste", "温顺型", 1, false, false],
    "star-cat": ["星灵猫", "mythic", "光", "mistwood", "傲娇型", 5, true, false],
  };
  for (const [id, [nameZh, rarityId, element, habitatId, personality, anim, d3, chat]] of Object.entries(expect)) {
    const s = byId[id];
    assert.ok(s, `物种 ${id} 存在`);
    assert.deepEqual(
      [s.nameZh, s.rarityId, s.element, s.habitatId, s.personalityTemplate, s.animationLevel, s.supports3d, s.supportsChat],
      [nameZh, rarityId, element, habitatId, personality, anim, d3, chat],
      `${id}（${nameZh}）文档属性`,
    );
    assert.ok(s.description.length > 0 && s.nameEn.length > 0, `${id} 简介/英文名`);
  }
});

test("species: 关系正确 —— 外键引用存在且全栖息地/全稀有度有覆盖", () => {
  for (const s of AIBI_SPECIES) {
    assert.ok(AIBI_RARITY_IDS.includes(s.rarityId), `${s.id} 稀有度外键 ${s.rarityId}`);
    assert.ok(AIBI_HABITAT_IDS.includes(s.habitatId), `${s.id} 栖息地外键 ${s.habitatId}`);
  }
  for (const h of AIBI_HABITAT_IDS) {
    assert.ok(AIBI_SPECIES.some((s) => s.habitatId === h), `栖息地 ${h} 至少有 1 个物种`);
  }
  for (const r of AIBI_RARITY_IDS) {
    assert.ok(AIBI_SPECIES.some((s) => s.rarityId === r), `稀有度 ${r} 至少有 1 个物种`);
  }
  const ids = AIBI_SPECIES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "物种 id 无重复");
});

// ============ 3.4 卡包（4 个） ============
test("packs: 4 个与文档价格/概率/范围/动画一致，概率合计 100", () => {
  assert.equal(AIBI_PACKS.length, 4);
  const byId = Object.fromEntries(AIBI_PACKS.map((p) => [p.id, p]));
  const expect = {
    starter: ["新手星雾卡包", 100, { common: 60, rare: 30, epic: 10 }, ["common", "rare"], 1],
    element: ["稀有元素卡包", 500, { rare: 40, epic: 40, legendary: 20 }, ["rare", "epic", "legendary"], 2],
    secret: ["史诗秘境卡包", 2000, { epic: 50, legendary: 30, mythic: 20 }, ["epic", "legendary", "mythic"], 3],
    summon: ["传说召唤卡包", 10000, { legendary: 40, mythic: 60 }, ["legendary", "mythic"], 4],
  };
  for (const [id, [nameZh, price, weights, allowed, anim]] of Object.entries(expect)) {
    const p = byId[id];
    assert.ok(p, `卡包 ${id} 存在`);
    assert.deepEqual(
      [p.nameZh, p.pricePoints, p.rarityWeights, p.allowedRarities, p.animationLevel],
      [nameZh, price, weights, allowed, anim],
      `${id} 文档属性`,
    );
    assert.equal(Object.values(p.rarityWeights).reduce((a, b) => a + b, 0), 100, `${id} 概率合计 100`);
    for (const r of p.allowedRarities) assert.ok(AIBI_RARITY_IDS.includes(r), `${id} 范围档位合法`);
  }
});

test("packs: 每个产出档位都有候选物种池（starter 范围外档位由降级规则兜底）", () => {
  for (const p of AIBI_PACKS) {
    for (const r of p.allowedRarities) {
      assert.ok(speciesPoolForPack(p.id, r).length >= 1, `${p.id}/${r} 候选池非空`);
    }
  }
  // starter 勘误锚定：epic 在权重里但不在范围里 → 服务层降级（epic→rare），稀有档池必须非空
  assert.deepEqual(speciesPoolForPack("starter", "epic"), []);
  assert.ok(speciesPoolForPack("starter", "rare").length >= 1);
});

// ============ 3.5 道具（5 个） ============
test("items: 5 个与文档效果/消耗方式/成长性格标记一致", () => {
  assert.equal(AIBI_ITEMS.length, 5);
  const byId = Object.fromEntries(AIBI_ITEMS.map((i) => [i.id, i]));
  // 末位为积分售价：Phase 4 补全（文档 3.5 未定价，4.2 /api/item/buy 所需，对齐 starter 卡包=100 梯度）
  const expect = {
    energy_fruit: ["能量果", "恢复艾比30点精力", { energy: 30 }, false, false, 50],
    affinity_candy: ["亲密度糖果", "提升艾比20点亲密度", { affinity: 20 }, false, true, 80],
    training_core: ["训练核心", "提升艾比50点成长经验", { growthExp: 50 }, true, false, 120],
    evolution_stone: ["进化石", "触发艾比进化", { evolve: true }, true, false, 2000],
    repair_chip: ["修复晶片", "恢复艾比100%状态", { restorePercent: 100 }, false, false, 200],
  };
  for (const [id, [nameZh, effect, payload, growth, personality, price]] of Object.entries(expect)) {
    const i = byId[id];
    assert.ok(i, `道具 ${id} 存在`);
    assert.deepEqual(
      [i.nameZh, i.itemType, i.effect, i.effectPayload, i.consumeMode, i.affectsGrowth, i.affectsPersonality, i.pricePoints],
      [nameZh, "consumable", effect, payload, "immediate", growth, personality, price],
      `${id} 文档属性`,
    );
  }
});

// ============ 种子 SQL 生成器（幂等 upsert） ============
test("seed-sql: 31 行全部 ON CONFLICT DO UPDATE，顺序满足外键", () => {
  assert.equal(AIBI_CATALOG_SEED_COUNT, 31);
  const stmts = buildAibiCatalogSeedSql();
  assert.equal(stmts.length, 31);
  for (const sql of stmts) {
    assert.ok(sql.includes(`ON CONFLICT ("id") DO UPDATE`), "全部幂等 upsert");
  }
  const first = (t) => stmts.findIndex((s) => s.includes(`INTO "${t}"`));
  const last = (t) => stmts.map((s, i) => (s.includes(`INTO "${t}"`) ? i : -1)).filter((i) => i >= 0).pop();
  assert.ok(last("aibi_rarities") < first("aibi_species"), "rarities 先于 species（FK）");
  assert.ok(last("aibi_habitats") < first("aibi_species"), "habitats 先于 species（FK）");
  assert.equal(stmts.filter((s) => s.includes('INTO "aibi_species"')).length, 12);
  assert.ok(stmts.some((s) => s.includes("'star-cat'") && s.includes("星灵猫")), "含 12 号物种");
  assert.ok(stmts.some((s) => s.includes('"common":60')), "starter 权重 jsonb");
});

// ============ 落库通道：迁移文件 / client.ts / 脚本 / package ============
test("0026 迁移：5 目录表 + 索引 + 回滚注释 + 不动旧表", () => {
  for (const t of ["aibi_rarities", "aibi_habitats", "aibi_species", "aibi_packs", "aibi_items"]) {
    assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS "${t}"`), `建表 ${t}`);
  }
  for (const idx of ["idx_aibi_species_rarity", "idx_aibi_species_habitat", "idx_aibi_packs_status"]) {
    assert.ok(migration.includes(idx), `索引 ${idx}`);
  }
  assert.ok(migration.includes("回滚方案"), "含回滚注释");
  assert.ok(migration.includes('"version" = 7'), "回滚指回 v7");
  const executable = migration.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/\b(DROP|ALTER)\s+TABLE\s+"(?!aibi_)/i.test(executable), "可执行语句不含对旧表的 DROP/ALTER");
});

test("client.ts v8→v9：内嵌目录 DDL + 种子生成器接入（SCHEMA_VERSION 当前=9，Phase 4 列补全）", () => {
  const sv = Number(client.match(/const SCHEMA_VERSION = (\d+);/)?.[1]);
  assert.ok(sv >= 9, `SCHEMA_VERSION 需 >=9（实际 ${sv}，后续版本迭代继续累加）`);
  assert.ok(client.includes("import { buildAibiCatalogSeedSql } from './aibi-catalog-seed'"));
  assert.ok(client.includes("...buildAibiCatalogSeedSql(),"));
  for (const t of ["aibi_rarities", "aibi_habitats", "aibi_species", "aibi_packs", "aibi_items"]) {
    assert.ok(client.includes(`CREATE TABLE IF NOT EXISTS "${t}"`), `内嵌建表 ${t}`);
  }
  for (const idx of ["idx_aibi_species_rarity", "idx_aibi_species_habitat", "idx_aibi_packs_status"]) {
    assert.ok(client.includes(`"${idx}"`), `内嵌索引 ${idx}`);
  }
});

test("脚本与 npm：独立种子脚本 + 重新导入命令", () => {
  assert.ok(seedScript.includes("buildAibiCatalogSeedSql"), "脚本复用同一生成器（不二次维护数据）");
  assert.ok(seedScript.includes("DATABASE_URL"), "脚本读取 DATABASE_URL");
  assert.ok(seedScript.includes("BEGIN") && seedScript.includes("COMMIT") && seedScript.includes("ROLLBACK"), "事务性灌入");
  assert.ok(pkg.scripts["seed:aibi"]?.includes("scripts/seed-aibi-catalog.ts"), "npm run seed:aibi 已注册");
});
