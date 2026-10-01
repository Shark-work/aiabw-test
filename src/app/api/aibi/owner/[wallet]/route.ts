import { pool, ensureDbSchemaOnce } from "@/db/client";
import { aibiCatch, aibiFail, aibiOk } from "@/lib/aibi-api";
import { getAibiSpecies } from "@/lib/aibi-catalog";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WALLET_RE = /^0x[0-9a-f]{4,}$/i;

/**
 * GET /api/aibi/owner/:wallet — 查询某地址（或用户 ID）拥有的全部艾比凭证
 *  - 0x 开头：按 user_wallets.wallet_address 反查持有人；
 *  - UUID：直接按 aibi_tokens.owner_id 查询（链下模拟期主用）。
 * 返回：{ data: { owner: string, count: number, tokens: [...] } }
 */
export async function GET(req: Request, { params }: { params: Promise<{ wallet: string }> }) {
  try {
    await ensureDbSchemaOnce();
    const { wallet } = await params;
    const key = decodeURIComponent(wallet).trim();

    let where: string;
    let param: string;
    if (WALLET_RE.test(key)) {
      where = `t.owner_id = (SELECT user_id FROM user_wallets WHERE lower(wallet_address) = lower($1) LIMIT 1)`;
      param = key;
    } else if (UUID_RE.test(key)) {
      where = `t.owner_id = $1::uuid`;
      param = key;
    } else {
      return aibiFail("VALIDATION_ERROR", 400, req);
    }

    const { rows } = await pool.query(
      `SELECT t.aibi_token_id AS "aibiTokenId", t.species_id AS "speciesId",
              t.status, t.physical_bound AS "physicalBound",
              t.created_at AS "createdAt",
              p.personality_type AS "personalityType", p.mood, p.affinity, p.energy,
              p.growth_level AS "growthLevel", p.growth_exp AS "growthExp"
         FROM aibi_tokens t
         LEFT JOIN aibi_personalities p ON p.aibi_token_id = t.aibi_token_id
        WHERE ${where} AND t.status = 'minted'
        ORDER BY t.created_at DESC`,
      [param],
    );

    const tokens = rows.map((r) => {
      const sp = getAibiSpecies(r.speciesId);
      return { ...r, species: sp ?? null };
    });
    return aibiOk({ owner: key, count: tokens.length, tokens });
  } catch (err) {
    return aibiCatch(err, req);
  }
}
