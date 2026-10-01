import { z } from "zod";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { aibiCatch, aibiFail, aibiOk, parseBody, AibiError } from "@/lib/aibi-api";
import { getAibiItem } from "@/lib/aibi-catalog";
import { applyGrowth, ENERGY_MAX, type GrowthState } from "@/lib/aibi-service";

export const runtime = "nodejs";

const bodySchema = z.object({
  itemId: z.string().min(1),
  tokenId: z.string().min(1),
});

/** effectPayload → 成长日志 action 映射（枚举：feed/train/talk/play/evolve）。 */
function actionForItem(effectPayload: Record<string, unknown>): "feed" | "play" | "train" | "evolve" {
  if ("evolve" in effectPayload) return "evolve";
  if ("growthExp" in effectPayload) return "train";
  if ("affinity" in effectPayload) return "play";
  return "feed"; // energy / restorePercent
}

/**
 * POST /api/bag/use — 使用道具作用于艾比
 * 请求体：{ itemId: string, tokenId: string }
 * 事务：校验凭证归属/可用 → 原子消耗一件道具（SKIP LOCKED）→
 *      按 effectPayload 结算成长状态 → UPDATE personalities + 成长日志（前后快照）。
 * 返回：{ data: { itemId, tokenId, action, state } }
 */
export async function POST(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const user = await getUserFromRequest(req);
    if (!user) return aibiFail("UNAUTHORIZED", 401, req);

    const body = await parseBody(req, bodySchema);
    const item = getAibiItem(body.itemId);
    if (!item) return aibiFail("ITEM_NOT_FOUND", 404, req);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 凭证校验（行锁）：必须本人持有且处于 minted
      const tokenRes = await client.query(
        `SELECT owner_id::text AS "ownerId", status FROM aibi_tokens
          WHERE aibi_token_id = $1 FOR UPDATE`,
        [body.tokenId],
      );
      if (!tokenRes.rows.length) throw new AibiError("TOKEN_NOT_FOUND", 404);
      if (tokenRes.rows[0].ownerId !== user.id) throw new AibiError("TOKEN_NOT_OWNED", 403);
      if (tokenRes.rows[0].status !== "minted") throw new AibiError("TOKEN_NOT_MINTED", 409);

      // 原子消耗一件道具：并发使用仅一个事务拿到同一行
      const consumed = await client.query(
        `DELETE FROM user_items
          WHERE id = (
            SELECT id FROM user_items
             WHERE user_id = $1::uuid AND item_key = $2 AND source = 'aibi_item'
             LIMIT 1
             FOR UPDATE SKIP LOCKED
          )
          RETURNING id`,
        [user.id, body.itemId],
      );
      if (!consumed.rows.length) throw new AibiError("INSUFFICIENT_ITEM", 400);

      // 当前成长状态（行锁）
      const perRes = await client.query(
        `SELECT personality_type AS "personalityType", mood, affinity, energy,
                growth_level AS "growthLevel", growth_exp AS "growthExp"
           FROM aibi_personalities WHERE aibi_token_id = $1 FOR UPDATE`,
        [body.tokenId],
      );
      if (!perRes.rows.length) throw new AibiError("TOKEN_NOT_FOUND", 404);
      const before: GrowthState = perRes.rows[0];

      // effectPayload 结算
      const p = item.effectPayload;
      const after = applyGrowth(before, {
        energy: typeof p.energy === "number" ? p.energy : p.restorePercent === 100 ? ENERGY_MAX - before.energy : 0,
        exp: typeof p.growthExp === "number" ? p.growthExp : 0,
        affinity: typeof p.affinity === "number" ? p.affinity : 0,
        levels: p.evolve === true ? 1 : 0,
        mood: p.evolve === true ? "进化" : p.restorePercent === 100 ? "焕然一新" : before.mood,
      });

      await client.query(
        `UPDATE aibi_personalities
            SET mood=$2, affinity=$3, energy=$4, growth_level=$5, growth_exp=$6,
                last_interacted_at=now(), updated_at=now()
          WHERE aibi_token_id=$1`,
        [body.tokenId, after.mood, after.affinity, after.energy, after.growthLevel, after.growthExp],
      );

      const action = actionForItem(p);
      await client.query(
        `INSERT INTO aibi_growth_logs ("aibi_token_id","action_type","before_state","after_state")
         VALUES ($1,$2,$3::jsonb,$4::jsonb)`,
        [body.tokenId, action, JSON.stringify({ ...before, item: body.itemId }), JSON.stringify({ ...after, item: body.itemId })],
      );

      await client.query("COMMIT");
      return aibiOk({ itemId: body.itemId, tokenId: body.tokenId, action, state: after });
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
