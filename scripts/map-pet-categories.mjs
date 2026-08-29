// 宠物分类/栖息地双语映射（本地化）：将 pet_dictionary.category/habitat 批量更新为英文列
// 用法: node scripts/map-pet-categories.mjs
import fs from "node:fs";
import { Pool } from "@neondatabase/serverless";

const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
const DATABASE_URL = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 8000 });

const CATEGORY_EN = {
  大型哺乳动物: "Large Mammal",
  小型哺乳动物: "Small Mammal",
  海洋生物: "Marine Life",
  爬行动物: "Reptile",
  犬科: "Canine",
  猫科: "Feline",
  鸟类: "Bird",
};

const HABITAT_EN = {
  丛林: "Jungle",
  南极: "Antarctic",
  古树: "Ancient Tree",
  密林: "Dense Forest",
  小镇: "Town",
  峭壁: "Cliff",
  庄园: "Estate",
  暖阁: "Greenhouse",
  松林: "Pine Forest",
  森林: "Forest",
  海藻林: "Kelp Forest",
  深蓝海域: "Deep Blue Sea",
  温暖洋流: "Warm Current",
  热带雨林: "Tropical Rainforest",
  牧场: "Pasture",
  珊瑚海葵: "Coral & Anemone",
  珊瑚礁: "Coral Reef",
  竹林: "Bamboo Forest",
  花园: "Garden",
  草原: "Grassland",
  荒漠绿洲: "Desert Oasis",
  荒野: "Wilderness",
  雨林枝头: "Rainforest Canopy",
  雪原: "Snowfield",
  高山: "Alpine",
};

(async () => {
  // 0) 幂等补列（与 src/db/client.ts SCHEMA_ALTERS 保持一致，脚本独立可跑）
  await pool.query(`ALTER TABLE "pet_dictionary" ADD COLUMN IF NOT EXISTS "category_en" text`);
  await pool.query(`ALTER TABLE "pet_dictionary" ADD COLUMN IF NOT EXISTS "habitat_en" text`);
  await pool.query(`ALTER TABLE "hotnews" ADD COLUMN IF NOT EXISTS "locale" text DEFAULT 'en' NOT NULL`);
  await pool.query(`DROP INDEX IF EXISTS idx_hotnews_source_title`);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_hotnews_locale_source_title ON "hotnews" ("locale", "source", "title")`,
  );

  // 1) 分类
  const cats = await pool.query("SELECT DISTINCT category FROM pet_dictionary ORDER BY category");
  const unknownCats = [];
  for (const r of cats.rows) {
    const zh = String(r.category);
    const en = CATEGORY_EN[zh];
    if (en) {
      await pool.query("UPDATE pet_dictionary SET category_en = $1 WHERE category = $2", [en, zh]);
      console.log(`  OK  category ${zh} -> ${en}`);
    } else {
      unknownCats.push(zh);
    }
  }
  // 2) 栖息地
  const habs = await pool.query(
    "SELECT DISTINCT habitat FROM pet_dictionary WHERE habitat IS NOT NULL ORDER BY habitat",
  );
  const unknownHabs = [];
  for (const r of habs.rows) {
    const zh = String(r.habitat);
    const en = HABITAT_EN[zh];
    if (en) {
      await pool.query("UPDATE pet_dictionary SET habitat_en = $1 WHERE habitat = $2", [en, zh]);
      console.log(`  OK  habitat ${zh} -> ${en}`);
    } else {
      unknownHabs.push(zh);
    }
  }
  if (unknownCats.length) console.log("WARN 未映射分类:", unknownCats.join(", "));
  if (unknownHabs.length) console.log("WARN 未映射栖息地:", unknownHabs.join(", "));

  // 3) 复核
  const r = await pool.query(
    `SELECT count(*)::int AS total,
            count(category_en)::int AS has_cat_en,
            count(habitat_en)::int AS has_hab_en
       FROM pet_dictionary`,
  );
  console.log("CHECK:", JSON.stringify(r.rows[0]));
  await pool.end();
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
