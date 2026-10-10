/**
 * 艾比大陆世界观内容体系 · 契约测试（2026-10-16）
 *
 *  A) 单一数据源 worldview-data.ts：8 区域/3 形态/5 信条/6 词条/3 古灵完整性 + 内容忠实性抽查；
 *  B) 种子链路：worldview-seed.ts 22 语句全 upsert + client.ts v22 四表 DDL + schema.ts 导出
 *     + drizzle/0037 与手动副本；
 *  C) 查询 API：/api/world（lang/四表/缓存/降级）+ /api/world/stats（单 SQL 4 指标）；
 *  D) /world 百科页：五板块 + 静态数据源 + metadata + 彩蛋挂载；
 *  E) 现有页面植入：详情页（形态/栖息地/故事）+ 探索页区域栏 + 图鉴形态筛选 + 导航入口；
 *  F) 灵魂树彩蛋：组件/统计拉取/树叶飘落 CSS/首页挂载/reduced-motion；
 *  G) i18n 双语 parity + Hero 副标题世界观文案；
 *  H) 用户-facing 无 mint/链上/NFT/合约/钱包地址 残留红线。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  WORLD_ANCIENTS,
  WORLD_GLOSSARY,
  WORLD_LIFE_FORMS,
  WORLD_REGIONS,
  WORLD_VALUES,
  lifeFormOfSpecies,
} from "../src/lib/worldview-data.ts";
import { buildWorldviewSeedSql } from "../src/db/worldview-seed.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// ───────────── A) 单一数据源完整性 ─────────────
test("worldview(A1): 数据源规模 = 8 区域 / 3 形态 / 5 信条 / 6 词条 / 3 古灵", () => {
  assert.equal(WORLD_REGIONS.length, 8, "8 大区域");
  assert.equal(WORLD_LIFE_FORMS.length, 3, "3 种生命形态");
  assert.equal(WORLD_VALUES.length, 5, "5 大信条");
  assert.equal(WORLD_GLOSSARY.length, 6, "6 个概念词条");
  assert.equal(WORLD_ANCIENTS.length, 3, "3 尊古灵");
});

test("worldview(A2): 区域 id 集合与文档一致 + habitat 映射（5 映射 + 3 空）", () => {
  const ids = WORLD_REGIONS.map((r) => r.id).sort();
  assert.deepEqual(ids, [
    "azure_coast", "cloud_islands", "frost_waste", "hourglass_desert",
    "lava_rift", "mech_ruins", "star_mist", "town",
  ]);
  const habitatMap = Object.fromEntries(WORLD_REGIONS.map((r) => [r.id, r.habitatId]));
  assert.equal(habitatMap.star_mist, "mistwood");
  assert.equal(habitatMap.lava_rift, "lavaforge");
  assert.equal(habitatMap.frost_waste, "frostshore");
  assert.equal(habitatMap.mech_ruins, "mechwaste");
  assert.equal(habitatMap.cloud_islands, "skyisles");
  for (const id of ["town", "azure_coast", "hourglass_desert"]) {
    assert.equal(habitatMap[id], null, `${id} 无对应栖息地`);
  }
  // sort_order 1..8 连续唯一（展示序）
  assert.deepEqual(WORLD_REGIONS.map((r) => r.sortOrder), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("worldview(A3): 内容忠实性抽查（文档原文关键要素）", () => {
  const town = WORLD_REGIONS.find((r) => r.id === "town");
  assert.ok(town.elementZh.includes("混沌"), "艾比小镇 = 混沌（全能）");
  assert.ok(town.descriptionZh.includes("灵魂树"), "小镇描述含灵魂树");
  const lava = WORLD_REGIONS.find((r) => r.id === "lava_rift");
  assert.ok(lava.descriptionZh.includes("焰心"), "熔岩裂谷含焰心化石 lore");
  assert.ok(lava.representativesZh.includes("炎鳞龙"), "熔岩裂谷代表灵宠 = 炎鳞龙");
  const desert = WORLD_REGIONS.find((r) => r.id === "hourglass_desert");
  assert.ok(desert.descriptionZh.includes("沙漠之眼"), "沙漏沙漠含沙漠之眼绿洲");
  // 三形态：id + 例子
  const [mortal, spirit, ancient] = WORLD_LIFE_FORMS;
  assert.deepEqual([mortal.id, spirit.id, ancient.id], ["mortal", "spirit", "ancient"]);
  assert.ok(spirit.examplesZh.includes("光翼蝶"), "灵宠例子含光翼蝶");
  assert.ok(ancient.examplesZh.includes("星瞳"), "古灵例子含星瞳(猫神)");
  // 五信条：id + 标语
  assert.deepEqual(WORLD_VALUES.map((v) => v.id), ["resonance", "explore", "collect", "bond", "legacy"]);
  assert.ok(WORLD_VALUES[0].sloganZh.includes("一个眼神"), "共鸣标语");
  assert.ok(WORLD_VALUES[4].sloganZh.includes("灯塔"), "传承标语");
  // 六词条
  assert.deepEqual(
    WORLD_GLOSSARY.map((g) => g.id),
    ["soul-seed", "soul-card", "leyline", "bond-crystal", "postcard", "soul-tree"],
  );
  assert.ok(WORLD_GLOSSARY[5].definitionZh.includes("故乡"), "灵魂树词条含「故乡」");
  // 古灵个体（文档 §3：焰心/云脊/星瞳）
  assert.deepEqual(WORLD_ANCIENTS.map((a) => a.id), ["flameheart", "cloudspine", "starpupil"]);
  // 全字段非空（区域）
  for (const r of WORLD_REGIONS) {
    for (const k of ["nameZh", "nameEn", "typeZh", "typeEn", "elementZh", "elementEn", "representativesZh", "representativesEn", "descriptionZh", "descriptionEn", "emoji"]) {
      assert.ok(String(r[k] ?? "").length > 0, `region ${r.id}.${k} 非空`);
    }
  }
});

test("worldview(A4): lifeFormOfSpecies——AIBI 目录物种=灵宠，其余=凡兽", () => {
  const aibiIds = new Set(["pyro-dragon", "light-butterfly", "wind-spirit", "steel-beast"]);
  assert.equal(lifeFormOfSpecies("pyro-dragon", aibiIds), "spirit");
  assert.equal(lifeFormOfSpecies("corgi", aibiIds), "mortal");
  assert.equal(lifeFormOfSpecies("persian-cat", aibiIds), "mortal");
});

// ───────────── B) 种子链路 ─────────────
test("worldview(B1): seed 生成器 22 语句全 ON CONFLICT DO UPDATE + 四表名", () => {
  const stmts = buildWorldviewSeedSql();
  assert.equal(stmts.length, 22, "8+3+5+6=22 条 upsert");
  for (const s of stmts) {
    assert.ok(s.includes('ON CONFLICT ("id") DO UPDATE'), "全部 DO UPDATE（内容可演进）");
    assert.ok(!/undefined|NaN/.test(s), "无 undefined/NaN 序列化事故");
  }
  for (const t of ["world_regions", "world_life_forms", "world_values", "world_glossary"]) {
    assert.ok(stmts.some((s) => s.includes(`INSERT INTO "${t}"`)), `种子覆盖 ${t}`);
  }
  assert.ok(stmts.some((s) => s.includes("艾比小镇") && s.includes("Aibi Town")), "区域种子双语");
});

test("worldview(B2): client.ts SCHEMA_VERSION=22 + 四表 DDL + 种子生成器接入", () => {
  const c = read("src/db/client.ts");
  assert.match(c, /const SCHEMA_VERSION = 22;/, "SCHEMA_VERSION bumped to 22");
  assert.ok(c.includes("import { buildWorldviewSeedSql } from './worldview-seed'"), "import 生成器");
  assert.ok(c.includes("...buildWorldviewSeedSql(),"), "种子语句入 SCHEMA_CREATES");
  for (const t of ["world_regions", "world_life_forms", "world_values", "world_glossary"]) {
    assert.ok(c.includes(`CREATE TABLE IF NOT EXISTS "${t}"`), `内嵌建表 ${t}`);
  }
  assert.ok(c.includes("v22: 艾比大陆世界观内容体系"), "v22 changelog 注释");
});

test("worldview(B3): schema.ts 四表导出 + drizzle/0037 + 手动迁移副本", () => {
  const s = read("src/db/schema.ts");
  for (const t of ["worldRegions = pgTable('world_regions'", "worldLifeForms = pgTable('world_life_forms'", "worldValues = pgTable('world_values'", "worldGlossary = pgTable('world_glossary'"]) {
    assert.ok(s.includes(t), `schema.ts 导出 ${t}`);
  }
  for (const f of ["drizzle/0037_worldview.sql", "scripts/migrate-worldview-tables.sql"]) {
    assert.ok(existsSync(join(ROOT, f)), `${f} exists`);
    const sql = read(f);
    for (const t of ["world_regions", "world_life_forms", "world_values", "world_glossary"]) {
      assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS "${t}"`), `${f} 建表 ${t}`);
    }
  }
});

// ───────────── C) 查询 API ─────────────
test("worldview(C1): /api/world——lang 双语分支 + 四表 ORDER BY + 60s 缓存 + 降级 null", () => {
  const r = read("src/app/api/world/route.ts");
  assert.ok(r.includes('searchParams.get("lang") === "en"'), "lang=en 分支");
  for (const t of ["world_regions", "world_life_forms", "world_values", "world_glossary"]) {
    assert.ok(r.includes(`FROM "${t}"`), `查询 ${t}`);
  }
  assert.ok((r.match(/ORDER BY "sort_order"/g) ?? []).length >= 4, "四表均按 sort_order 排序");
  assert.ok(r.includes("60_000"), "60s 内存缓存");
  assert.ok(r.includes("data: null"), "DB 异常静默降级 null");
  assert.ok(r.includes('"name_zh" AS "name"') && r.includes('"name_en" AS "name"'), "双语列映射");
});

test("worldview(C2): /api/world/stats——单 SQL 4 指标 + 缓存 + 降级", () => {
  const r = read("src/app/api/world/stats/route.ts");
  for (const src of ["FROM pet_dictionary", "FROM aibi_species", "FROM world_regions", "FROM adoptions"]) {
    assert.ok(r.includes(src), `指标源 ${src}`);
  }
  assert.ok(r.includes("60_000"), "60s 缓存");
  assert.ok(r.includes("stats: null"), "降级 null");
  for (const k of ["speciesTotal", "soulPetSpeciesTotal", "regionsTotal", "resonancesTotal"]) {
    assert.ok(r.includes(k), `返回字段 ${k}`);
  }
});

// ───────────── D) /world 百科页 ─────────────
test("worldview(D1): /world 页面——五板块 + 静态数据源 + metadata + 彩蛋", () => {
  const p = read("src/app/[locale]/world/page.tsx");
  for (const k of ["creationTitle", "mapTitle", "lifeFormsTitle", "valuesTitle", "glossaryTitle"]) {
    assert.ok(p.includes(`t("${k}")`), `板块标题 ${k}`);
  }
  assert.ok(p.includes("creationP1") && p.includes("creationP2"), "创世神话两段叙事");
  for (const c of ["WORLD_REGIONS", "WORLD_LIFE_FORMS", "WORLD_VALUES", "WORLD_GLOSSARY"]) {
    assert.ok(p.includes(`${c}.map(`), `${c} 渲染`);
  }
  assert.ok(p.includes("generateMetadata"), "SEO metadata");
  assert.ok(p.includes("<SoulTreeEgg />"), "灵魂树彩蛋挂载");
  assert.ok(p.includes('href="/explore-v2"'), "底部探索 CTA");
  assert.ok(p.includes("WORLD_REGIONS.map") && p.includes("representativesLabel"), "区域卡含代表灵宠");
});


// ───────────── E) 现有页面植入 ─────────────
test("worldview(E1): 灵宠详情页——生命形态标签 + 栖息地 lore + 背景小故事", () => {
  const p = read("src/app/[locale]/pets/[id]/page.tsx");
  assert.ok(p.includes("lifeFormOfSpecies(species.id, AIBI_SPECIES_IDS)"), "生命形态判定");
  assert.ok(p.includes("WORLD_LIFE_FORMS.find"), "形态元信息");
  assert.ok(p.includes('WORLD_REGIONS.find((r) => r.id === "town")'), "凡兽栖息地=艾比小镇");
  assert.ok(p.includes("habitatLoreTitle") && p.includes("storyTitle"), "栖息地+故事区块");
  assert.ok(p.includes('tw("worldLink")'), "世界观入口链接");
  assert.ok(p.includes("lifeFormMortalStory") && p.includes("lifeFormSpiritStory"), "双形态故事模板");
});

test("worldview(E2): 探索页——WorldRegionsSection 挂载 + 8 区域卡 + 区域志弹窗", () => {
  const panel = read("src/components/exploration-v2/explore-v2-panel.tsx");
  assert.ok(panel.includes('import { WorldRegionsSection } from "@/components/world/world-regions-section"'), "import");
  assert.ok(panel.includes("<WorldRegionsSection />"), "mounted");
  const c = read("src/components/world/world-regions-section.tsx");
  assert.ok(c.includes("WORLD_REGIONS.map("), "8 区域卡渲染");
  assert.ok(c.includes("regionLoreTitle"), "区域志弹窗");
  assert.ok(c.includes('href="/world"'), "世界观页链接");
  assert.ok(c.includes("useState<WorldRegion | null>"), "弹窗状态");
});

test("worldview(E3): 图鉴页——生命形态筛选（凡兽/灵宠/古灵三分支）", () => {
  const p = read("src/app/[locale]/pets/page.tsx");
  assert.ok(p.includes('useState<"" | "mortal" | "spirit" | "ancient">("")'), "lifeForm state");
  for (const k of ["filterAll", "filterMortal", "filterSpirit", "filterAncient"]) {
    assert.ok(p.includes(`tw("${k}")`), `chip ${k}`);
  }
  assert.ok(p.includes('lifeForm === "spirit"'), "灵宠分支");
  assert.ok(p.includes("AIBI_SPECIES.map("), "灵宠静态卡（AIBI 目录 12 种）");
  assert.ok(p.includes('lifeForm === "ancient"'), "古灵分支");
  assert.ok(p.includes("WORLD_ANCIENTS.map("), "古灵沉睡卡");
  assert.ok(p.includes('tw("ancientEmpty")'), "古灵空态文案");
  assert.ok(p.includes('href="/codex"'), "灵宠→艾比图鉴引导");
});

test("worldview(E4): 导航栏——moreItems 收纳 /world 世界观入口", () => {
  const h = read("src/components/layout/SiteHeader.tsx");
  const worldLine = h.split(/\r?\n/).find((l) => l.includes('"/world"'));
  assert.ok(worldLine, "/world 入口存在");
  assert.ok(worldLine.includes('t("navWorld")'), "入口绑定 navWorld i18n");
  // 在 moreItems 数组内（主导航 C2 四主入口不变）
  const moreIdx = h.indexOf("const moreItems = [");
  const worldIdx = h.indexOf('"/world"');
  assert.ok(worldIdx > moreIdx, "/world 收纳进「更多」（不占主入口）");
});

// ───────────── F) 灵魂树彩蛋 ─────────────
test("worldview(F1): 彩蛋组件——弹窗 + 统计拉取 + 树叶飘落 + 降级", () => {
  const c = read("src/components/world/soul-tree.tsx");
  assert.ok(c.includes('fetch("/api/world/stats"'), "统计接口拉取");
  assert.ok(c.includes("soulTreeMyth"), "创世神话短文案");
  assert.ok(c.includes("LEAVES"), "树叶飘落配置");
  assert.ok(c.includes("soul-tree-leaf"), "树叶 CSS 类");
  assert.ok(c.includes("soul-tree-glow"), "光芒 CSS 类");
  assert.ok(c.includes('role="dialog"'), "弹窗 a11y");
  assert.ok(c.includes("stats && ("), "统计失败静默降级");
  assert.ok(c.includes("resonancesTotal"), "总共鸣次数展示");
});

test("worldview(F2): 彩蛋挂载（首页 Hero + /world 页）+ CSS 动画 + reduced-motion", () => {
  const home = read("src/app/[locale]/page.tsx");
  assert.ok(home.includes('import { SoulTreeEgg } from "@/components/world/soul-tree"'), "首页 import");
  assert.ok(home.includes("<SoulTreeEgg />"), "首页挂载");
  const world = read("src/app/[locale]/world/page.tsx");
  assert.ok(world.includes("<SoulTreeEgg />"), "/world 挂载");
  const css = read("src/app/globals.css");
  assert.ok(css.includes("@keyframes soul-tree-glow"), "光芒 keyframes");
  assert.ok(css.includes("@keyframes soul-tree-leaf-fall"), "飘落 keyframes");
  const blocks = css.split("@media (prefers-reduced-motion: reduce)");
  assert.ok(
    blocks.some((b) => b.includes(".soul-tree-leaf") && b.includes(".soul-tree-glow")),
    "reduced-motion 豁免",
  );
});


// ───────────── G) i18n ─────────────
test("worldview(G1): worldview 命名空间双语 parity + 关键 key + Hero 副标题 + navWorld", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  const zk = Object.keys(zh.worldview ?? {}).sort();
  const ek = Object.keys(en.worldview ?? {}).sort();
  assert.ok(zk.length >= 40, "worldview 文案齐备");
  assert.deepEqual(zk, ek, "worldview 双语 key 完全对齐");
  for (const k of [
    "pageTitle", "creationP1", "creationP2", "mapTitle", "lifeFormsTitle", "valuesTitle",
    "glossaryTitle", "soulTreeCta", "soulTreeMyth", "statsResonances", "lifeFormLabel",
    "habitatLoreTitle", "storyTitle", "filterMortal", "filterSpirit", "filterAncient",
    "ancientEmpty", "regionsExploreTitle", "regionLoreTitle", "worldLink",
  ]) {
    assert.ok(zh.worldview[k] && en.worldview[k], `worldview.${k} 双语`);
  }
  // Hero 副标题 = 世界观叙事（产出物 2-1）
  assert.ok(zh.home.subtitle.includes("灵魂种子") && zh.home.subtitle.includes("八大区域"), "zh 副标题世界观化");
  assert.ok(en.home.subtitle.includes("Aibi Continent") && en.home.subtitle.includes("eight regions"), "en 副标题世界观化");
  assert.equal(zh.nav.navWorld, "🌍 世界观", "zh navWorld");
  assert.equal(en.nav.navWorld, "🌍 Worldview", "en navWorld");
});

// ───────────── H) 用户-facing 无区块链术语残留红线 ─────────────
test("worldview(H1): 用户-facing 无 mint/链上/NFT/合约/钱包地址 残留", () => {
  // 1) messages 值层（t() 渲染文案唯一来源）：{minted}/{burned} 为数字占位符，渲染后不可见，豁免
  for (const f of ["messages/zh.json", "messages/en.json"]) {
    const j = JSON.parse(read(f));
    const values = [];
    const walk = (o) => {
      for (const v of Object.values(o)) {
        if (typeof v === "string") values.push(v);
        else if (v && typeof v === "object") walk(v);
      }
    };
    walk(j);
    for (const v of values) {
      const rendered = v.replace(/\{(minted|burned|total|count|name|url|days|level|max|sign|owned|maxCount|pet|points|reason|amount|date|time|n|x)\}/g, "");
      assert.ok(!/NFT|链上|合约|钱包地址/i.test(rendered), `${f} 无区块链术语：${v.slice(0, 40)}`);
      assert.ok(!/\bmint\b/i.test(rendered), `${f} 无可见 mint 字样：${v.slice(0, 40)}`);
    }
  }
  // 2) 组件/页面 tsx：NFT/钱包地址 零命中；「链上/mint」仅允许注释形态（历史 aibi 模拟链体系注释）
  const dirs = ["src/components", "src/app/[locale]"];
  const files = [];
  const collect = (d) => {
    for (const f of readdirSync(join(ROOT, d))) {
      const rel = `${d}/${f}`;
      const st = statSync(join(ROOT, rel));
      if (st.isDirectory()) collect(rel);
      else if (/\.(tsx|ts)$/.test(f)) files.push(rel);
    }
  };
  for (const d of dirs) collect(d);
  for (const rel of files) {
    const src = read(rel);
    assert.ok(!/NFT|钱包地址/.test(src), `${rel} 无 NFT/钱包地址`);
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/链上/.test(l)) {
        // 注释形态：// 行注释、/* 块注释起手、块注释续行（* 开头）、{/* JSX 注释
        assert.ok(
          /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l),
          `${rel}:${i + 1} 「链上」仅允许注释形态：${l.trim().slice(0, 50)}`,
        );
      }
    }
  }
});

