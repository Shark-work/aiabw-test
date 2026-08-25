import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { adminError, requireAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";

/**
 * GET /api/admin/stats
 * 数据看板核心指标：总用户数 / 今日新增 / 累计访问量 / 今日合成次数。
 */
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  try {
    const [{ rows: totalU }, { rows: todayU }, { rows: visits }, { rows: consumed }] = await Promise.all([
      pool.query(`SELECT count(*)::int AS n FROM users`),
      pool.query(`SELECT count(*)::int AS n FROM users WHERE created_at >= date_trunc('day', now())`),
      pool.query(`SELECT visit_count::bigint AS n FROM site_visits WHERE id = 1`),
      // 合成 3:1：今日消耗的宠物数 / 3 ≈ 今日合成次数
      pool.query(`SELECT count(*)::int AS n FROM pets WHERE status = 'consumed' AND created_at >= date_trunc('day', now())`),
    ]);

    return NextResponse.json({
      ok: true,
      stats: {
        totalUsers: totalU[0]?.n ?? 0,
        todayUsers: todayU[0]?.n ?? 0,
        totalVisits: Number(visits[0]?.n ?? 0),
        todayFusions: Math.floor((consumed[0]?.n ?? 0) / 3),
      },
    });
  } catch (err) {
    console.error("[admin/stats]", err);
    return adminError();
  }
}
