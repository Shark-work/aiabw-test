/**
 * 世界观种子 SQL 生成器（2026-10-16，艾比大陆世界观）
 *
 * 从 src/lib/worldview-data.ts（单一数据源）生成幂等 upsert 语句：
 *  - client.ts 版本闸门自动同步时执行（生产免手动）；
 *  - scripts/migrate-worldview-tables.sql 为同结构手动副本（紧急回通用）。
 * 全部 INSERT ... ON CONFLICT ("id") DO UPDATE —— 可反复执行，
 * 不产生重复行，且世界观文案修订后重跑即刷新（worldview 视为可演进内容）。
 * 四表均无外键（habitat_id 仅逻辑映射 aibi_habitats.id，不建 FK 约束）。
 */
import {
  WORLD_GLOSSARY,
  WORLD_LIFE_FORMS,
  WORLD_REGIONS,
  WORLD_VALUES,
} from "../lib/worldview-data";

const esc = (v: string) => v.replace(/'/g, "''");
const nullable = (v: string | null) => (v === null ? "NULL" : `'${esc(v)}'`);

export function buildWorldviewSeedSql(): string[] {
  const stmts: string[] = [];

  for (const r of WORLD_REGIONS) {
    stmts.push(
      `INSERT INTO "world_regions" ("id","name_zh","name_en","type_zh","type_en","element_zh","element_en","representatives_zh","representatives_en","description_zh","description_en","habitat_id","emoji","sort_order")` +
        ` VALUES ('${r.id}','${esc(r.nameZh)}','${esc(r.nameEn)}','${esc(r.typeZh)}','${esc(r.typeEn)}','${esc(r.elementZh)}','${esc(r.elementEn)}','${esc(r.representativesZh)}','${esc(r.representativesEn)}','${esc(r.descriptionZh)}','${esc(r.descriptionEn)}',${nullable(r.habitatId)},'${r.emoji}',${r.sortOrder})` +
        ` ON CONFLICT ("id") DO UPDATE SET "name_zh"=EXCLUDED."name_zh","name_en"=EXCLUDED."name_en","type_zh"=EXCLUDED."type_zh","type_en"=EXCLUDED."type_en","element_zh"=EXCLUDED."element_zh","element_en"=EXCLUDED."element_en","representatives_zh"=EXCLUDED."representatives_zh","representatives_en"=EXCLUDED."representatives_en","description_zh"=EXCLUDED."description_zh","description_en"=EXCLUDED."description_en","habitat_id"=EXCLUDED."habitat_id","emoji"=EXCLUDED."emoji","sort_order"=EXCLUDED."sort_order"`,
    );
  }

  for (const f of WORLD_LIFE_FORMS) {
    stmts.push(
      `INSERT INTO "world_life_forms" ("id","name_zh","name_en","title_zh","title_en","description_zh","description_en","examples_zh","examples_en","emoji","sort_order")` +
        ` VALUES ('${f.id}','${esc(f.nameZh)}','${esc(f.nameEn)}','${esc(f.titleZh)}','${esc(f.titleEn)}','${esc(f.descriptionZh)}','${esc(f.descriptionEn)}','${esc(f.examplesZh)}','${esc(f.examplesEn)}','${f.emoji}',${f.sortOrder})` +
        ` ON CONFLICT ("id") DO UPDATE SET "name_zh"=EXCLUDED."name_zh","name_en"=EXCLUDED."name_en","title_zh"=EXCLUDED."title_zh","title_en"=EXCLUDED."title_en","description_zh"=EXCLUDED."description_zh","description_en"=EXCLUDED."description_en","examples_zh"=EXCLUDED."examples_zh","examples_en"=EXCLUDED."examples_en","emoji"=EXCLUDED."emoji","sort_order"=EXCLUDED."sort_order"`,
    );
  }

  for (const v of WORLD_VALUES) {
    stmts.push(
      `INSERT INTO "world_values" ("id","name_zh","name_en","slogan_zh","slogan_en","feature_zh","feature_en","emoji","sort_order")` +
        ` VALUES ('${v.id}','${esc(v.nameZh)}','${esc(v.nameEn)}','${esc(v.sloganZh)}','${esc(v.sloganEn)}','${esc(v.featureZh)}','${esc(v.featureEn)}','${v.emoji}',${v.sortOrder})` +
        ` ON CONFLICT ("id") DO UPDATE SET "name_zh"=EXCLUDED."name_zh","name_en"=EXCLUDED."name_en","slogan_zh"=EXCLUDED."slogan_zh","slogan_en"=EXCLUDED."slogan_en","feature_zh"=EXCLUDED."feature_zh","feature_en"=EXCLUDED."feature_en","emoji"=EXCLUDED."emoji","sort_order"=EXCLUDED."sort_order"`,
    );
  }

  for (const g of WORLD_GLOSSARY) {
    stmts.push(
      `INSERT INTO "world_glossary" ("id","term_zh","term_en","definition_zh","definition_en","emoji","sort_order")` +
        ` VALUES ('${g.id}','${esc(g.termZh)}','${esc(g.termEn)}','${esc(g.definitionZh)}','${esc(g.definitionEn)}','${g.emoji}',${g.sortOrder})` +
        ` ON CONFLICT ("id") DO UPDATE SET "term_zh"=EXCLUDED."term_zh","term_en"=EXCLUDED."term_en","definition_zh"=EXCLUDED."definition_zh","definition_en"=EXCLUDED."definition_en","emoji"=EXCLUDED."emoji","sort_order"=EXCLUDED."sort_order"`,
    );
  }

  return stmts;
}
