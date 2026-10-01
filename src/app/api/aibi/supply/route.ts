import { pool, ensureDbSchemaOnce } from "@/db/client";
import { aibiCatch, aibiOk } from "@/lib/aibi-api";
import { getAibiSpecies } from "@/lib/aibi-catalog";
import { readSupply, readSupplyHistory, readSupplySnapshots } from "@/lib/aibi-service";

export const runtime = "nodejs";

/**
 * GET /api/aibi/supply?page=1&pageSize=20 — 供应看板（8.8）
 * 返回：{ data: { totalMinted, totalBurned, currentSupply, maxSupply,
 *                 latestSnapshot, snapshots, history } }
 *  - totalMinted / totalBurned：append-only 日志权威口径；
 *  - currentSupply：aibi_tokens status='minted' 实时计数；链下模拟 maxSupply = null（不封顶）；
 *  - snapshots：近 10 条快照（时间升序，趋势展示）；
 *  - history：增发/销毁合并时间线（公开脱敏：不含用户字段），分页（文档「列表页必须支持分页」）。
 */
export async function GET(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const url = new URL(req.url);
    const page = Math.max(1, Math.min(1000, Number(url.searchParams.get("page")) || 1));
    const pageSize = Math.max(1, Math.min(50, Number(url.searchParams.get("pageSize")) || 20));

    const stats = await readSupply(pool);
    const { rows } = await pool.query(
      `SELECT total_minted AS "totalMinted", total_burned AS "totalBurned",
              current_supply AS "currentSupply", created_at AS "createdAt"
         FROM supply_snapshots
        ORDER BY created_at DESC
        LIMIT 1`,
    );
    const snapshots = await readSupplySnapshots(pool, 10);
    const history = await readSupplyHistory(pool, page, pageSize);
    return aibiOk({
      ...stats,
      latestSnapshot: rows[0] ?? null,
      snapshots,
      history: {
        ...history,
        rows: history.rows.map((r) => ({ ...r, species: getAibiSpecies(r.speciesId) ?? null })),
      },
    });
  } catch (err) {
    return aibiCatch(err, req);
  }
}
