import { z } from "zod";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { aibiCatch, aibiFail, aibiOk, parseBody } from "@/lib/aibi-api";
import { mintAibi } from "@/lib/aibi-service";

export const runtime = "nodejs";

const bodySchema = z.object({
  speciesId: z.string().min(1),
  /** 接收人（缺省 = 当前管理员本人） */
  ownerId: z.uuid().optional(),
  /** 公开铸造接口仅允许 admin_mint；pack_open / fusion_generate 等由对应内部流程触发 */
  source: z.literal("admin_mint").default("admin_mint"),
});

/**
 * POST /api/aibi/mint — 铸造新艾比凭证（敏感接口：仅管理员）
 * 请求体：{ speciesId: string, ownerId?: uuid, source?: "admin_mint" }
 * 返回：{ data: { aibiTokenId, speciesId, ownerId, status, mintedAt, supplyAfter } }
 */
export async function POST(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const user = await getUserFromRequest(req);
    if (!user) return aibiFail("UNAUTHORIZED", 401, req);

    // 权限校验：仅管理员可主动铸造
    const { rows } = await pool.query(`SELECT role FROM users WHERE id = $1::uuid`, [user.id]);
    if (rows[0]?.role !== "admin") return aibiFail("FORBIDDEN", 403, req);

    const body = await parseBody(req, bodySchema);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const minted = await mintAibi(client, {
        speciesId: body.speciesId,
        ownerId: body.ownerId ?? user.id,
        source: body.source,
      });
      await client.query("COMMIT");
      return aibiOk(minted);
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
