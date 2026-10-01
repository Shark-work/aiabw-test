import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { aibiCatch, aibiFail, aibiOk } from "@/lib/aibi-api";
import { getAibiSpecies } from "@/lib/aibi-catalog";

export const runtime = "nodejs";

/**
 * GET /api/bag/aibis — 当前登录用户的艾比凭证列表（背包页数据源）
 * 与 /api/aibi/owner/:wallet 同查询，但免传用户标识（Bearer 令牌即身份）。
 * 返回：{ data: { count: number, tokens: [...] } }
 *  - tokens 含物种档案（species）与性格/成长字段（personalityType/mood/affinity/energy/growthLevel/growthExp）。
 */
export async function GET(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const user = await getUserFromRequest(req);
    if (!user) return aibiFail("UNAUTHORIZED", 401, req);

    const { rows } = await pool.query(
      `SELECT t.aibi_token_id AS "aibiTokenId", t.species_id AS "speciesId",
              t.status, t.physical_bound AS "physicalBound",
              t.created_at AS "createdAt",
              p.personality_type AS "personalityType", p.mood, p.affinity, p.energy,
              p.growth_level AS "growthLevel", p.growth_exp AS "growthExp"
         FROM aibi_tokens t
         LEFT JOIN aibi_personalities p ON p.aibi_token_id = t.aibi_token_id
        WHERE t.owner_id = $1::uuid AND t.status = 'minted'
        ORDER BY t.created_at DESC`,
      [user.id],
    );

    const tokens = rows.map((r) => {
      const sp = getAibiSpecies(r.speciesId);
      return { ...r, species: sp ?? null };
    });
    return aibiOk({ count: tokens.length, tokens });
  } catch (err) {
    return aibiCatch(err, req);
  }
}
