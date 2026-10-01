import { z } from "zod";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { aibiCatch, aibiFail, aibiOk, parseBody, AibiError } from "@/lib/aibi-api";

export const runtime = "nodejs";

const bodySchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
});

/**
 * POST /api/item/buy — 使用积分购买道具
 * 请求体：{ itemId: string, quantity?: number(1-99) }
 * 事务：原子扣分 → points_log('aibi_item_buy') → 背包入库
 *      （user_items，item_key=itemId，source='aibi_item'，每件一行）。
 * 返回：{ data: { itemId, quantity, cost, balance } }
 */
export async function POST(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const user = await getUserFromRequest(req);
    if (!user) return aibiFail("UNAUTHORIZED", 401, req);

    const body = await parseBody(req, bodySchema);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const itemRes = await client.query(
        `SELECT price_points AS "pricePoints" FROM aibi_items WHERE id = $1`,
        [body.itemId],
      );
      if (!itemRes.rows.length) throw new AibiError("ITEM_NOT_FOUND", 404);
      const cost = Number(itemRes.rows[0].pricePoints) * body.quantity;

      const upd = await client.query(
        `UPDATE users SET points = points - $1 WHERE id = $2::uuid AND points >= $1 RETURNING points`,
        [cost, user.id],
      );
      if (!upd.rows.length) throw new AibiError("INSUFFICIENT_POINTS", 402);

      await client.query(
        `INSERT INTO points_log (user_id, amount, reason) VALUES ($1::uuid, $2, 'aibi_item_buy')`,
        [user.id, -cost],
      );
      await client.query(
        `INSERT INTO user_items (user_id, item_key, rarity, source)
         SELECT $1::uuid, $2, 'common', 'aibi_item' FROM generate_series(1, $3)`,
        [user.id, body.itemId, body.quantity],
      );

      await client.query("COMMIT");
      return aibiOk({ itemId: body.itemId, quantity: body.quantity, cost, balance: upd.rows[0].points });
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
