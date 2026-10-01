import { pool, ensureDbSchemaOnce } from "@/db/client";
import { aibiCatch, aibiOk } from "@/lib/aibi-api";
import { getAibiSpecies } from "@/lib/aibi-catalog";
import { readSpotlight } from "@/lib/aibi-service";

export const runtime = "nodejs";

/**
 * GET /api/aibi/spotlight — 首页焦点数据（公开）
 * 返回：{ data: { latest: [...], rareShowcase: [...] } }
 *  - latest：最新铸造的流通中艾比（含物种档案，供 AibiCard 直接渲染）；
 *  - rareShowcase：高稀有物种热度榜（无传说/神话铸造时回退全物种榜，首页不留空）。
 */
export async function GET(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const data = await readSpotlight(pool);
    return aibiOk({
      latest: data.latest.map((r) => ({ ...r, species: getAibiSpecies(r.speciesId) ?? null })),
      rareShowcase: data.rareShowcase.map((r) => ({
        ...r,
        species: getAibiSpecies(r.speciesId) ?? null,
      })),
    });
  } catch (err) {
    return aibiCatch(err, req);
  }
}
