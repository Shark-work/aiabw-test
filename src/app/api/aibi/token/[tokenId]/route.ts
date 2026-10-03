import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { aibiCatch, aibiFail, aibiOk } from "@/lib/aibi-api";
import { getAibiSpecies } from "@/lib/aibi-catalog";
import { readTokenDetail } from "@/lib/aibi-service";

export const runtime = "nodejs";

/**
 * GET /api/aibi/token/[tokenId] — 艾比凭证公开详情（8.3 详情页数据源）
 *  - 公开可读 = 稀缺凭证可验证性：不返回任何用户隐私字段，
 *    持有者仅以钱包地址或脱敏 id（user-****xxxx）形式展示；
 *  - 携带 Bearer 令牌时额外返回 viewerIsOwner（前端据此开放互动入口）；
 *  - provenance：mint/burn 全履历（来源/原因/模拟交易哈希/事后供应）。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  try {
    await ensureDbSchemaOnce();
    const { tokenId } = await params;
    const detail = await readTokenDetail(pool, tokenId);
    if (!detail) return aibiFail("TOKEN_NOT_FOUND", 404, req);

    // 可选鉴权：仅用于判断「当前访问者是否持有者」，不影响公开字段
    const viewer = await getUserFromRequest(req);
    const viewerIsOwner = !!viewer && !!detail.ownerId && viewer.id === detail.ownerId;

    // 剥离内部字段（ownerId 不下发；void 标记显式丢弃，过 no-unused-vars）。
    // threadId 同样默认剥离：/chat?thread=<id> 的 SSR 消息加载不校验归属，
    // threadId 即「窥视钥匙」——仅持有者（viewerIsOwner）下放，绝不公开。
    const { ownerId, threadId, ...publicDetail } = detail;
    void ownerId;
    void threadId;
    return aibiOk({
      ...publicDetail,
      species: getAibiSpecies(detail.speciesId) ?? null,
      viewerIsOwner,
      ...(viewerIsOwner ? { threadId } : {}),
    });
  } catch (err) {
    return aibiCatch(err, req);
  }
}
