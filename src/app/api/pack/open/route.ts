import { z } from "zod";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { aibiCatch, aibiFail, aibiOk, parseBody, AibiError } from "@/lib/aibi-api";
import { getAibiPack } from "@/lib/aibi-catalog";
import { mintAibi, pickSpeciesForRarity, rollPackRarity } from "@/lib/aibi-service";

export const runtime = "nodejs";

const bodySchema = z.object({ packId: z.string().min(1) });

/**
 * POST /api/pack/open — 打开卡包获得艾比凭证
 * 请求体：{ packId: string }
 * 事务：原子消耗背包中一包（SKIP LOCKED 防并发双开）→ 加权掷稀有度
 *      （勘误降级：掷出 allowedRarities 之外档位时落到范围内最高档）→
 *      随机物种 → 铸造（mint_logs source='pack_open'）。
 * 返回：{ data: { packId, rarity, species, token } }
 */
export async function POST(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const user = await getUserFromRequest(req);
    if (!user) return aibiFail("UNAUTHORIZED", 401, req);

    const body = await parseBody(req, bodySchema);
    const pack = getAibiPack(body.packId);
    if (!pack) return aibiFail("PACK_NOT_FOUND", 404, req);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 原子消耗一包：并发开包仅一个事务拿到同一行
      const consumed = await client.query(
        `DELETE FROM user_items
          WHERE id = (
            SELECT id FROM user_items
             WHERE user_id = $1::uuid AND item_key = 'pack:' || $2 AND source = 'aibi_pack'
             LIMIT 1
             FOR UPDATE SKIP LOCKED
          )
          RETURNING id`,
        [user.id, body.packId],
      );
      if (!consumed.rows.length) throw new AibiError("INSUFFICIENT_ITEM", 400);

      const rarityId = rollPackRarity(pack);
      const species = pickSpeciesForRarity(pack, rarityId);
      const token = await mintAibi(client, {
        speciesId: species.id,
        ownerId: user.id,
        source: "pack_open",
      });

      await client.query("COMMIT");
      return aibiOk({ packId: body.packId, rarity: rarityId, species, token });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    return aibiCatch(err, req);
  }
}
