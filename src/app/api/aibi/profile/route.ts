import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { aibiCatch, aibiFail, aibiOk } from "@/lib/aibi-api";
import { getAibiSpecies } from "@/lib/aibi-catalog";
import { readUserAibiSummary } from "@/lib/aibi-service";

export const runtime = "nodejs";

/**
 * GET /api/aibi/profile?page=1&pageSize=10 — 用户中心聚合（8.7，需登录）
 * 返回：{ data: { aibiCount, itemCount, packCount, wallet, mints: {...}, burns: {...} } }
 *  - mints/burns 各自分页（同一 page/pageSize 参数，文档「列表页必须支持分页」）；
 *  - 历史行附物种档案（名称/稀有度，前端免二次查询）。
 */
export async function GET(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const user = await getUserFromRequest(req);
    if (!user) return aibiFail("UNAUTHORIZED", 401, req);

    const url = new URL(req.url);
    const page = Math.max(1, Math.min(1000, Number(url.searchParams.get("page")) || 1));
    const pageSize = Math.max(1, Math.min(50, Number(url.searchParams.get("pageSize")) || 10));

    const summary = await readUserAibiSummary(pool, user.id, page, pageSize);
    return aibiOk({
      ...summary,
      mints: {
        ...summary.mints,
        rows: summary.mints.rows.map((r) => ({ ...r, species: getAibiSpecies(r.speciesId) ?? null })),
      },
      burns: {
        ...summary.burns,
        rows: summary.burns.rows.map((r) => ({ ...r, species: getAibiSpecies(r.speciesId) ?? null })),
      },
    });
  } catch (err) {
    return aibiCatch(err, req);
  }
}
