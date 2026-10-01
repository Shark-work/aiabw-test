import { z } from "zod";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { aibiCatch, aibiFail, aibiOk, parseBody } from "@/lib/aibi-api";
import { burnAibi, type BurnReason } from "@/lib/aibi-service";

export const runtime = "nodejs";

const ADMIN_REASONS = ["user_burn", "expired_burn", "physical_redeem"] as const;

const bodySchema = z.object({
  tokenId: z.string().min(1),
  /** 仅管理员可指定；普通持有人固定 user_burn */
  reason: z.enum(ADMIN_REASONS).optional(),
});

/**
 * POST /api/aibi/burn — 销毁艾比凭证
 * 权限：持有人可销毁自己的（reason 固定 user_burn）；管理员可销毁任意（可指定 reason）。
 * 返回：{ data: { aibiTokenId, supplyAfter } }
 */
export async function POST(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const user = await getUserFromRequest(req);
    if (!user) return aibiFail("UNAUTHORIZED", 401, req);

    const body = await parseBody(req, bodySchema);

    const { rows } = await pool.query(
      `SELECT owner_id::text AS "ownerId", status FROM aibi_tokens WHERE aibi_token_id = $1`,
      [body.tokenId],
    );
    if (!rows.length) return aibiFail("TOKEN_NOT_FOUND", 404, req);

    const isOwner = rows[0].ownerId === user.id;
    let reason: BurnReason = "user_burn";
    if (!isOwner) {
      const role = await pool.query(`SELECT role FROM users WHERE id = $1::uuid`, [user.id]);
      if (role.rows[0]?.role !== "admin") return aibiFail("TOKEN_NOT_OWNED", 403, req);
      reason = body.reason ?? "user_burn";
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const burned = await burnAibi(client, { tokenId: body.tokenId, reason, fromUserId: rows[0].ownerId });
      await client.query("COMMIT");
      return aibiOk(burned);
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
