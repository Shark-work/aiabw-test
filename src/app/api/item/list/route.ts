import { pool, ensureDbSchemaOnce } from "@/db/client";
import { aibiCatch, aibiOk } from "@/lib/aibi-api";

export const runtime = "nodejs";

/**
 * GET /api/item/list — 可购买道具列表（名称 / 效果 / 积分价格）
 * 返回：{ data: { items: [...] } }
 */
export async function GET(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const { rows } = await pool.query(
      `SELECT id, name_zh AS "nameZh", name_en AS "nameEn", item_type AS "itemType",
              effect, effect_en AS "effectEn", effect_payload AS "effectPayload",
              consume_mode AS "consumeMode", affects_growth AS "affectsGrowth",
              affects_personality AS "affectsPersonality", price_points AS "pricePoints"
         FROM aibi_items
        ORDER BY price_points ASC`,
    );
    return aibiOk({ items: rows });
  } catch (err) {
    return aibiCatch(err, req);
  }
}
