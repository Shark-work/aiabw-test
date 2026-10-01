import { z } from "zod";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { aibiCatch, aibiFail, aibiOk, parseBody, AibiError } from "@/lib/aibi-api";
import { fuseAibis, FUSION_MAX, FUSION_MIN } from "@/lib/aibi-service";

export const runtime = "nodejs";

const bodySchema = z.object({
  /** 参与融合的凭证编号列表（2~5 只，全部须为本人持有的可用艾比） */
  tokenIds: z.array(z.string().min(1)).min(FUSION_MIN).max(FUSION_MAX),
});

/**
 * POST /api/aibi/fuse — 融合多只艾比生成新艾比
 * 请求体：{ tokenIds: string[] }
 * 规则：素材全部销毁（burn_logs reason=fusion_consume）；结果稀有度 = 素材最高档，
 *       物种从该档池随机（mint_logs source=fusion_generate）。
 * 返回：{ data: { consumed, minted: { aibiTokenId, speciesId, species, ... } } }
 */
export async function POST(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const user = await getUserFromRequest(req);
    if (!user) return aibiFail("UNAUTHORIZED", 401, req);

    const body = await parseBody(req, bodySchema);
    if (new Set(body.tokenIds).size !== body.tokenIds.length) {
      throw new AibiError("FUSION_INVALID", 400);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fuseAibis(client, { userId: user.id, tokenIds: body.tokenIds });
      await client.query("COMMIT");
      return aibiOk(result);
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
