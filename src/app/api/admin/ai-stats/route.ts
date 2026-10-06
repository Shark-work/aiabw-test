import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { adminError, requireAdmin } from "@/lib/admin-guard";
import { aiInFlight, AI_MAX_CONCURRENCY } from "@/lib/llm-fallback";

export const runtime = "nodejs";

/**
 * GET /api/admin/ai-stats — Phase 8 · AI 成本监控面板数据（admin 专属）。
 * 响应：
 *  {
 *    ok,
 *    cache: { entries, hits, hitRate, expired },  // 命中率 = hits / (hits + entries)
 *    scopes: [{ scope, entries, hits, expired }],  // 按业务域分组
 *    concurrency: { inFlight, max },               // 实例级在途并发（本实例口径）
 *  }
 * 命中率口径：每行缓存代表一次 miss（写入），hits 列累计命中次数；
 * hitRate = hits / (hits + entries)，保留 3 位小数，零数据时为 0。
 */
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  try {
    const { rows } = await pool.query(`
      SELECT scope,
             COUNT(*)::int AS entries,
             COALESCE(SUM(hits), 0)::int AS hits,
             COUNT(*) FILTER (WHERE expires_at <= now())::int AS expired
        FROM "ai_response_cache"
       GROUP BY scope
       ORDER BY hits DESC, entries DESC`);
    const totalEntries = rows.reduce((s, r) => s + Number(r.entries), 0);
    const totalHits = rows.reduce((s, r) => s + Number(r.hits), 0);
    const totalExpired = rows.reduce((s, r) => s + Number(r.expired), 0);
    return NextResponse.json({
      ok: true,
      cache: {
        entries: totalEntries,
        hits: totalHits,
        hitRate:
          totalEntries + totalHits > 0
            ? +(totalHits / (totalEntries + totalHits)).toFixed(3)
            : 0,
        expired: totalExpired,
      },
      scopes: rows,
      concurrency: { inFlight: aiInFlight(), max: AI_MAX_CONCURRENCY },
    });
  } catch (err) {
    console.error("[admin/ai-stats] query failed:", err);
    return adminError("ai-stats query failed");
  }
}
