import { z } from "zod";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { aibiCatch, aibiFail, aibiOk, parseBody, AibiError } from "@/lib/aibi-api";
import { AIBI_PACK_SALES_DISCONTINUED } from "@/lib/aibi-flags";

export const runtime = "nodejs";

const bodySchema = z.object({
  packId: z.string().min(1),
  quantity: z.number().int().min(1).max(10).default(1),
});

/**
 * POST /api/pack/buy — 使用积分购买卡包
 * 请求体：{ packId: string, quantity?: number(1-10) }
 * 事务：原子扣分（points >= cost 守卫）→ points_log('aibi_pack_buy') → 背包入库
 *      （user_items，item_key='pack:'+packId，source='aibi_pack'，每包一行）。
 * 返回：{ data: { packId, quantity, cost, balance } }
 */
export async function POST(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const user = await getUserFromRequest(req);
    if (!user) return aibiFail("UNAUTHORIZED", 401, req);

    // P0 概念收敛（2026-10-14）：卡包停售（艾比凭证停铸配套），410 短路；
    // 历史实现完整保留（积分原子扣费/背包入库），便于回滚评估。
    if (AIBI_PACK_SALES_DISCONTINUED) return aibiFail("DISCONTINUED", 410, req);

    const body = await parseBody(req, bodySchema);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const packRes = await client.query(
        `SELECT price_points AS "pricePoints" FROM aibi_packs WHERE id = $1 AND status = 'active'`,
        [body.packId],
      );
      if (!packRes.rows.length) throw new AibiError("PACK_NOT_FOUND", 404);
      const cost = Number(packRes.rows[0].pricePoints) * body.quantity;

      // 原子扣费：余额不足时不产生任何写动作
      const upd = await client.query(
        `UPDATE users SET points = points - $1 WHERE id = $2::uuid AND points >= $1 RETURNING points`,
        [cost, user.id],
      );
      if (!upd.rows.length) throw new AibiError("INSUFFICIENT_POINTS", 402);

      await client.query(
        `INSERT INTO points_log (user_id, amount, reason) VALUES ($1::uuid, $2, 'aibi_pack_buy')`,
        [user.id, -cost],
      );
      await client.query(
        `INSERT INTO user_items (user_id, item_key, rarity, source)
         SELECT $1::uuid, 'pack:' || $2, 'common', 'aibi_pack' FROM generate_series(1, $3)`,
        [user.id, body.packId, body.quantity],
      );

      await client.query("COMMIT");
      return aibiOk({ packId: body.packId, quantity: body.quantity, cost, balance: upd.rows[0].points });
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
