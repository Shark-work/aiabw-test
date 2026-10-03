import { z } from "zod";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { aibiCatch, aibiFail, aibiOk, parseBody } from "@/lib/aibi-api";
import { getAibiSpecies } from "@/lib/aibi-catalog";

export const runtime = "nodejs";

const BodySchema = z.object({
  aibiTokenId: z.string().trim().min(1).max(32),
});

/**
 * POST /api/threads — 创建对话线程并关联到指定 Aibi 凭证（Aibi ↔ 聊天 · 方案 a 入口）
 *
 *  - 校验：凭证存在（404）→ 归属当前用户（403）→ status='minted'（409）；
 *  - 幂等：凭证已有 thread_id 时直接返回（created:false），重复点击/重放安全；
 *  - 并发守护：UPDATE ... WHERE thread_id IS NULL，后到请求回滚自建线程并回读既有值，
 *    不产生孤儿线程。
 * 返回：{ data: { threadId, created } }
 */
export async function POST(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const user = await getUserFromRequest(req);
    if (!user) return aibiFail("UNAUTHORIZED", 401, req);
    const { aibiTokenId } = await parseBody(req, BodySchema);

    // 凭证存在性 / 归属 / 状态校验（与 /api/interact 同一口径）
    const { rows } = await pool.query(
      `SELECT aibi_token_id AS "aibiTokenId", species_id AS "speciesId",
              owner_id AS "ownerId", status, thread_id AS "threadId"
         FROM aibi_tokens
        WHERE aibi_token_id = $1
        LIMIT 1`,
      [aibiTokenId],
    );
    const token = rows[0];
    if (!token) return aibiFail("TOKEN_NOT_FOUND", 404, req);
    if (!token.ownerId || String(token.ownerId) !== user.id) {
      return aibiFail("TOKEN_NOT_OWNED", 403, req);
    }
    if (token.status !== "minted") return aibiFail("TOKEN_NOT_MINTED", 409, req);

    // 幂等快速路径：已绑定线程 → 直接返回
    if (token.threadId) {
      return aibiOk({ threadId: token.threadId, created: false });
    }

    const sp = getAibiSpecies(token.speciesId);
    const title = `${sp?.nameEn ?? aibiTokenId}'s Home`;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: created } = await client.query(
        `INSERT INTO threads (user_id, title) VALUES ($1, $2) RETURNING id`,
        [user.id, title],
      );
      const threadId = created[0].id as string;
      // 并发守护：仅当仍为空时回填；rowCount=0 说明另一请求已抢先绑定
      const upd = await client.query(
        `UPDATE aibi_tokens SET thread_id = $1, updated_at = now()
          WHERE aibi_token_id = $2 AND thread_id IS NULL`,
        [threadId, aibiTokenId],
      );
      if ((upd.rowCount ?? 0) === 0) {
        // 并发：回滚新建线程，回读既有绑定（不产生孤儿线程）
        await client.query("ROLLBACK");
        const { rows: again } = await pool.query(
          `SELECT thread_id AS "threadId" FROM aibi_tokens WHERE aibi_token_id = $1 LIMIT 1`,
          [aibiTokenId],
        );
        return aibiOk({ threadId: again[0]?.threadId ?? null, created: false });
      }
      await client.query("COMMIT");
      return aibiOk({ threadId, created: true });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    return aibiCatch(err, req);
  }
}
