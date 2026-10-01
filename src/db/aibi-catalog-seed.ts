/**
 * 目录种子 SQL 生成器（平台升级 Phase 3，2026-09-30）
 *
 * 从 src/lib/aibi-catalog.ts（单一数据源）生成幂等 upsert 语句：
 *  - client.ts 版本闸门自动同步时执行（生产免手动）；
 *  - scripts/seed-aibi-catalog.ts 手动重导时执行同一组语句。
 * 全部 INSERT ... ON CONFLICT ("id") DO UPDATE —— 可反复执行，
 * 不产生重复行，且源数据修订后重跑即刷新（catalog 视为可演进内容）。
 * 顺序保证外键成立：rarities / habitats → species；packs / items 无外键。
 */
import {
  AIBI_HABITATS,
  AIBI_ITEMS,
  AIBI_PACKS,
  AIBI_RARITIES,
  AIBI_SPECIES,
} from "../lib/aibi-catalog";

const esc = (v: string) => v.replace(/'/g, "''");
const json = (v: unknown) => `'${JSON.stringify(v)}'::jsonb`;

export function buildAibiCatalogSeedSql(): string[] {
  const stmts: string[] = [];

  for (const r of AIBI_RARITIES) {
    stmts.push(
      `INSERT INTO "aibi_rarities" ("id","name_zh","name_en","color","multiplier","sort_order")` +
        ` VALUES ('${r.id}','${esc(r.nameZh)}','${esc(r.nameEn)}','${r.color}',${r.multiplier},${r.sortOrder})` +
        ` ON CONFLICT ("id") DO UPDATE SET "name_zh"=EXCLUDED."name_zh","name_en"=EXCLUDED."name_en","color"=EXCLUDED."color","multiplier"=EXCLUDED."multiplier","sort_order"=EXCLUDED."sort_order"`,
    );
  }
  for (const h of AIBI_HABITATS) {
    stmts.push(
      `INSERT INTO "aibi_habitats" ("id","name_zh","name_en","element_affinity","element_affinity_en","description","description_en")` +
        ` VALUES ('${h.id}','${esc(h.nameZh)}','${esc(h.nameEn)}','${esc(h.elementAffinity)}','${esc(h.elementAffinityEn)}','${esc(h.description)}','${esc(h.descriptionEn)}')` +
        ` ON CONFLICT ("id") DO UPDATE SET "name_zh"=EXCLUDED."name_zh","name_en"=EXCLUDED."name_en","element_affinity"=EXCLUDED."element_affinity","element_affinity_en"=EXCLUDED."element_affinity_en","description"=EXCLUDED."description","description_en"=EXCLUDED."description_en"`,
    );
  }
  for (const s of AIBI_SPECIES) {
    stmts.push(
      `INSERT INTO "aibi_species" ("id","name_zh","name_en","rarity_id","element","habitat_id","description","description_en","personality_template","personality_template_en","animation_level","supports_3d","supports_chat")` +
        ` VALUES ('${s.id}','${esc(s.nameZh)}','${esc(s.nameEn)}','${s.rarityId}','${esc(s.element)}','${s.habitatId}','${esc(s.description)}','${esc(s.descriptionEn)}','${esc(s.personalityTemplate)}','${esc(s.personalityTemplateEn)}',${s.animationLevel},${s.supports3d},${s.supportsChat})` +
        ` ON CONFLICT ("id") DO UPDATE SET "name_zh"=EXCLUDED."name_zh","name_en"=EXCLUDED."name_en","rarity_id"=EXCLUDED."rarity_id","element"=EXCLUDED."element","habitat_id"=EXCLUDED."habitat_id","description"=EXCLUDED."description","description_en"=EXCLUDED."description_en","personality_template"=EXCLUDED."personality_template","personality_template_en"=EXCLUDED."personality_template_en","animation_level"=EXCLUDED."animation_level","supports_3d"=EXCLUDED."supports_3d","supports_chat"=EXCLUDED."supports_chat"`,
    );
  }
  for (const p of AIBI_PACKS) {
    stmts.push(
      `INSERT INTO "aibi_packs" ("id","name_zh","name_en","price_points","rarity_weights","allowed_rarities","animation_level","status")` +
        ` VALUES ('${p.id}','${esc(p.nameZh)}','${esc(p.nameEn)}',${p.pricePoints},${json(p.rarityWeights)},${json(p.allowedRarities)},${p.animationLevel},'active')` +
        ` ON CONFLICT ("id") DO UPDATE SET "name_zh"=EXCLUDED."name_zh","name_en"=EXCLUDED."name_en","price_points"=EXCLUDED."price_points","rarity_weights"=EXCLUDED."rarity_weights","allowed_rarities"=EXCLUDED."allowed_rarities","animation_level"=EXCLUDED."animation_level","status"=EXCLUDED."status"`,
    );
  }
  for (const i of AIBI_ITEMS) {
    // price_points 为 Phase 4（v9）补全列；v9 ALTER 先于种子执行，旧库平滑
    stmts.push(
      `INSERT INTO "aibi_items" ("id","name_zh","name_en","item_type","effect","effect_en","effect_payload","consume_mode","affects_growth","affects_personality","price_points")` +
        ` VALUES ('${i.id}','${esc(i.nameZh)}','${esc(i.nameEn)}','${i.itemType}','${esc(i.effect)}','${esc(i.effectEn)}',${json(i.effectPayload)},'${i.consumeMode}',${i.affectsGrowth},${i.affectsPersonality},${i.pricePoints})` +
        ` ON CONFLICT ("id") DO UPDATE SET "name_zh"=EXCLUDED."name_zh","name_en"=EXCLUDED."name_en","item_type"=EXCLUDED."item_type","effect"=EXCLUDED."effect","effect_en"=EXCLUDED."effect_en","effect_payload"=EXCLUDED."effect_payload","consume_mode"=EXCLUDED."consume_mode","affects_growth"=EXCLUDED."affects_growth","affects_personality"=EXCLUDED."affects_personality","price_points"=EXCLUDED."price_points"`,
    );
  }
  return stmts;
}

/** 种子行数（测试锚定：5 稀有度 + 5 栖息地 + 12 物种 + 4 卡包 + 5 道具 = 31） */
export const AIBI_CATALOG_SEED_COUNT =
  AIBI_RARITIES.length + AIBI_HABITATS.length + AIBI_SPECIES.length + AIBI_PACKS.length + AIBI_ITEMS.length;
