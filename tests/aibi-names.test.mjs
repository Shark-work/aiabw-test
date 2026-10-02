// 艾比名映射（aibi-names）单元 + 契约测试：
//  1) 映射完整性：首批史诗+物种 7 个全部有 zh/en 双语（2026-09-30 生产库口径锁定：
//     pet_dictionary ⋈ pets[active+visible] 物种最高稀有度 ≥ epic）；
//  2) aibiNameFor / aibiNameEligible / rarityByWeight 纯函数行为；
//  3) petDisplayName species:<id> 分支契约（api-errors.ts 含 JSON import 不便直接加载，
//     按仓库契约测试惯例做源码断言 + i18n 数据源断言）；
//  4) 增量字段契约：catalog / claim / /api/pets / 聊天页 / 图鉴卡 / 详情页均接入派生；
//  5) SEO 强约束回归锁：详情页 generateMetadata / JSON-LD / sitemap 零 aibi 引用；
//  6) i18n 键存在（petsCatalog.prototypeLabel / seo.aibiNameLabel 双语）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AIBI_NAMES,
  AIBI_RARITY_MIN_WEIGHT,
  aibiNameEligible,
  aibiNameFor,
} from "../src/lib/aibi-names.ts";
import { rarityByWeight, rarityWeight } from "../src/lib/species-group.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** 首批映射清单（与 aibi-names.ts 头注释口径一致；扩充物种时同步更新）。 */
const EXPECTED_IDS = [
  "blue_whale",
  "cheetah",
  "octopus",
  "penguin",
  "red_panda",
  "sea_otter",
  "tortoise",
];

// ---- 1) 映射完整性 ----
test("aibi-names: 首批映射严格覆盖 7 个史诗+物种（无漏项、无多余）", () => {
  assert.deepEqual(Object.keys(AIBI_NAMES).sort(), EXPECTED_IDS);
});

test("aibi-names: 每条映射 zh/en 双语齐全且形态正确", () => {
  for (const [id, v] of Object.entries(AIBI_NAMES)) {
    assert.ok(v.zh && v.en, `${id} 双语齐全`);
    assert.match(v.zh, /[一-鿿]/, `${id}.zh 含中文`);
    assert.match(v.en, /^[A-Za-z][A-Za-z ]*$/, `${id}.en 为英文`);
  }
});

test("aibi-names: 映射物种全部存在于字典种子清单（seed-pet-dictionary）", () => {
  const seed = read("scripts/seed-pet-dictionary.cjs");
  for (const id of EXPECTED_IDS) {
    assert.ok(seed.includes(`id: "${id}"`), `字典物种清单含 ${id}`);
  }
});

// ---- 2) 纯函数行为 ----
test("aibiNameFor: 命中返回本地化艾比名，未命中/空输入返回 null", () => {
  assert.equal(aibiNameFor("penguin", "zh"), "墩墩");
  assert.equal(aibiNameFor("penguin", "en"), "Waddles");
  assert.equal(aibiNameFor("blue_whale", "zh"), "泡泡");
  assert.equal(aibiNameFor("sea_otter", "en"), "Pebble");
  assert.equal(aibiNameFor("snow_leopard", "zh"), null); // 未进首批映射
  assert.equal(aibiNameFor("", "zh"), null);
  assert.equal(aibiNameFor(null, "zh"), null);
  assert.equal(aibiNameFor(undefined, "en"), null);
});

test("aibiNameEligible: epic/legendary 过门槛，其余保守回退", () => {
  for (const r of ["epic", "legendary"]) assert.ok(aibiNameEligible(r), r);
  for (const r of ["common", "uncommon", "rare", "mythic", "", null, undefined]) {
    assert.ok(!aibiNameEligible(r), String(r));
  }
  assert.equal(AIBI_RARITY_MIN_WEIGHT, rarityWeight("epic"));
});

test("rarityByWeight: 权重反查（SQL MAX 聚合结果 → 稀有度名）", () => {
  assert.equal(rarityByWeight(5), "legendary");
  assert.equal(rarityByWeight(4), "epic");
  assert.equal(rarityByWeight(3), "rare");
  assert.equal(rarityByWeight(2), "uncommon");
  assert.equal(rarityByWeight(1), "common");
  assert.equal(rarityByWeight(0), null);
  assert.equal(rarityByWeight(6), null);
});

// ---- 3) petDisplayName species 分支契约 + 数据源 ----
test("contract: petDisplayName 扩展 species:<id> 分支（门槛内聚 + 兜底保留）", () => {
  const src = read("src/i18n/api-errors.ts");
  assert.ok(src.includes("isSpeciesPetType(petType)"), "species 分支");
  assert.ok(src.includes("aibiNameEligible(rarity)"), "稀有度门槛");
  assert.ok(src.includes("aibiNameFor(speciesIdOf(petType), locale)"), "映射派生");
  assert.ok(src.includes("aibi ?? fallback"), "无映射/未达门槛回退原型名");
});

test("i18n 数据源: 老三宠本地化不受影响（fox = 抱抱狐 / Huggy Fox）", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  assert.equal(zh.pets?.fox?.name, "抱抱狐");
  assert.equal(en.pets?.fox?.name, "Huggy Fox");
});

// ---- 4) 增量字段契约 ----
test("contract: catalog 普通 + 聚合两分支均派生 aibiName", () => {
  const src = read("src/app/api/pets/catalog/route.ts");
  assert.ok(src.includes("aibiNameFor(r.species_id, locale)"), "普通模式");
  assert.ok(src.includes("aibiNameFor(c.speciesId, locale)"), "聚合模式");
});

test("contract: claim 响应 pet 派生 aibiName", () => {
  assert.ok(
    read("src/app/api/pets/claim/route.ts").includes("aibiNameFor(pet.species_id, locale)"),
  );
});

test("contract: /api/pets displayName 携带稀有度门槛（实例聚合 + 第 4 参）", () => {
  const src = read("src/app/api/pets/route.ts");
  assert.ok(src.includes("speciesRarityW"), "物种稀有度聚合查询");
  assert.ok(
    src.includes("rarityByWeight(speciesRarityW.get(speciesIdOf(a.petType)) ?? 0)"),
    "displayName 传 rarity",
  );
});

test("contract: 聊天头部 SSR 按门槛替换艾比名（DB 快照不动）", () => {
  const src = read("src/app/[locale]/chat/page.tsx");
  assert.ok(src.includes("aibiNameFor(speciesIdOf(petType), locale)"));
  assert.ok(src.includes("aibiNameEligible(rarityByWeight("));
});

test("contract: 图鉴卡按门槛显示艾比名 + 原型副标", () => {
  const src = read("src/app/[locale]/pets/page.tsx");
  assert.ok(src.includes("showAibi ? pet.aibiName : pet.speciesName"));
  assert.ok(src.includes('t("prototypeLabel"'));
  assert.ok(src.includes("rarityWeight(pet.traits.rarity) >= AIBI_RARITY_MIN_WEIGHT"));
});

test("contract: my-pets 经 displayName 内聚门槛自动生效（无独立分支被旁路）", () => {
  const myPets = read("src/app/[locale]/my-pets/page.tsx");
  assert.ok(myPets.includes("pet.displayName || pet.petName"), "my-pets 消费 displayName");
});

test("contract: 详情页页面内艾比名副标题（仅页面内）", () => {
  const src = read("src/app/[locale]/pets/[id]/page.tsx");
  assert.ok(src.includes('t("aibiNameLabel"'));
  assert.ok(src.includes("aibiNameFor(species.id, locale)"));
});

// ---- 5) SEO 强约束回归锁 ----
test("contract: 详情页 generateMetadata 零 aibi 引用（title/OG 维持原型名）", () => {
  const src = read("src/app/[locale]/pets/[id]/page.tsx");
  const meta = src.slice(
    src.indexOf("export async function generateMetadata"),
    src.indexOf("export default async function"),
  );
  assert.ok(!/aibi/i.test(meta), "generateMetadata 函数体不含 aibi");
  assert.ok(meta.includes('t("petDetailTitle", { name })'), "title 仍用原型名");
  assert.ok(meta.includes("openGraph"), "OG 字段仍在");
});

test("contract: 详情页 JSON-LD 与 sitemap 零 aibi 引用", () => {
  const detail = read("src/app/[locale]/pets/[id]/page.tsx");
  assert.ok(
    detail.includes("name: `${species.nameZh}｜${species.nameEn} - 艾比世界 AI 虚拟宠物`"),
    "JSON-LD 维持原型名",
  );
  // sitemap 本就收录 /aibi 链上生态页（品牌词），此处锁定「艾比名派生」未进入 sitemap
  const sitemap = read("src/app/sitemap.ts");
  assert.ok(!sitemap.includes("aibiNameFor") && !sitemap.includes("AIBI_NAMES"), "sitemap 零艾比名派生");
});

// ---- 6) i18n 键 ----
test("i18n: petsCatalog.prototypeLabel / seo.aibiNameLabel 双语齐全", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  assert.ok(zh.petsCatalog?.prototypeLabel?.includes("{name}"), "zh prototypeLabel");
  assert.ok(en.petsCatalog?.prototypeLabel?.includes("{name}"), "en prototypeLabel");
  assert.ok(zh.seo?.aibiNameLabel?.includes("{name}"), "zh aibiNameLabel");
  assert.ok(en.seo?.aibiNameLabel?.includes("{name}"), "en aibiNameLabel");
});
