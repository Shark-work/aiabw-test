import { pool, ensureDbSchemaOnce } from "@/db/client";
import { aibiCatch, aibiOk } from "@/lib/aibi-api";

export const runtime = "nodejs";

/**
 * GET /api/pack/list — 可购买卡包列表（名称 / 价格 / 稀有度概率 / 产出范围）
 * 返回：{ data: { packs: [...] } }
 */
export async function GET(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const { rows } = await pool.query(
      `SELECT id, name_zh AS "nameZh", name_en AS "nameEn",
              price_points AS "pricePoints",
              rarity_weights AS "rarityWeights", allowed_rarities AS "allowedRarities",
              animation_level AS "animationLevel"
         FROM aibi_packs
        WHERE status = 'active'
        ORDER BY price_points ASC`,
    );
    return aibiOk({ packs: rows });
  } catch (err) {
    return aibiCatch(err, req);
  }
}
