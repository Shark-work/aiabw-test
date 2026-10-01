import { pool, ensureDbSchemaOnce } from "@/db/client";
import { aibiCatch, aibiOk } from "@/lib/aibi-api";
import { AIBI_SPECIES, getAibiRarity } from "@/lib/aibi-catalog";

export const runtime = "nodejs";

/**
 * GET /api/aibi/list — 可铸造（可获得）艾比物种目录（公开）
 * 返回：{ data: { count: number, species: [...] } }
 *  - 每个物种附稀有度档案（颜色/倍率）与已铸造数量（mint_logs 口径，含已销毁）。
 */
export async function GET(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const { rows } = await pool.query(
      `SELECT species_id AS "speciesId", count(*)::int AS "mintedCount"
         FROM mint_logs
        GROUP BY species_id`,
    );
    const mintedMap = new Map<string, number>(rows.map((r) => [r.speciesId, r.mintedCount]));

    const species = AIBI_SPECIES.map((sp) => ({
      ...sp,
      rarity: getAibiRarity(sp.rarityId) ?? null,
      mintedCount: mintedMap.get(sp.id) ?? 0,
    }));
    return aibiOk({ count: species.length, species });
  } catch (err) {
    return aibiCatch(err, req);
  }
}
