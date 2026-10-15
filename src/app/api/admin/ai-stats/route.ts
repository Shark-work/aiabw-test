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
 *    petChat: { total7d, keywordRate, bySource, byIntent },  // 宠物对话 7 日观测
 *  }
 * petChat 口径（intent-resolver 三来源）：keyword=关键词短路零成本 / llm=大模型 /
 * fallback=降级；keywordRate = keyword / total（零成本占比，越高越省钱）。
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

    // 宠物对话 7 日观测（pet_play_logs：intent-resolver 三来源 + LLM 耗时/token + 意图分布）
    const [srcRes, intentRes] = await Promise.all([
      pool.query(`
        SELECT COALESCE(source, 'ai') AS source,
               COUNT(*)::int AS count,
               COALESCE(AVG(duration_ms), 0)::int AS "avgMs",
               COALESCE(SUM(tokens_used), 0)::int AS tokens
          FROM "pet_play_logs"
         WHERE kind = 'chat' AND created_at > now() - interval '7 days'
         GROUP BY COALESCE(source, 'ai')
         ORDER BY count DESC`),
      pool.query(`
        SELECT action, COUNT(*)::int AS count
          FROM "pet_play_logs"
         WHERE kind = 'chat' AND created_at > now() - interval '7 days'
           AND action IN ('pet','eat','play','sleep','wake')
         GROUP BY action
         ORDER BY count DESC`),
    ]);
    const petTotal = srcRes.rows.reduce((s, r) => s + Number(r.count), 0);
    const petKeyword = Number(srcRes.rows.find((r) => r.source === "keyword")?.count ?? 0);

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
      petChat: {
        total7d: petTotal,
        keywordRate: petTotal > 0 ? +(petKeyword / petTotal).toFixed(3) : 0,
        bySource: srcRes.rows,
        byIntent: intentRes.rows,
      },
    });
  } catch (err) {
    console.error("[admin/ai-stats] query failed:", err);
    return adminError("ai-stats query failed");
  }
}
