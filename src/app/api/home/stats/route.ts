import { NextResponse } from "next/server";

import { pool } from "@/db/client";

export const runtime = "nodejs";

/**
 * GET /api/home/stats — 首页底部「社区活跃数据」（Phase 7 · 7.1-6）
 *
 * 公开只读（无需登录），单 SQL 聚合 4 指标：
 *  - bornToday：今日新生伙伴（adoptions.adopted_at >= 当日零点，DB 时区口径）；
 *  - explorationsToday：今日探索次数（exploration_records.created_at 同口径）；
 *  - soulCardsTotal：在册灵魂卡总量（soul_cards status='active'）；
 *  - collectorsTotal：收藏家总数（users）。
 * 缓存：模块级内存 TTL 60s（与 /api/news、/api/visits 同模式，避免每请求 4 次全表计数）。
 */
export type HomeStats = {
  bornToday: number;
  explorationsToday: number;
  soulCardsTotal: number;
  collectorsTotal: number;
};

const CACHE_TTL_MS = 60_000;
let cache: { stats: HomeStats; expiresAt: number } | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now < cache.expiresAt) {
    return NextResponse.json({ ok: true, stats: cache.stats });
  }

  try {
    const { rows } = await pool.query<{
      born_today: number;
      explorations_today: number;
      soul_cards_total: number;
      collectors_total: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM adoptions
           WHERE adopted_at >= date_trunc('day', now())) AS born_today,
         (SELECT count(*)::int FROM exploration_records
           WHERE created_at >= date_trunc('day', now())) AS explorations_today,
         (SELECT count(*)::int FROM soul_cards
           WHERE status = 'active') AS soul_cards_total,
         (SELECT count(*)::int FROM users) AS collectors_total`,
    );
    const r = rows[0];
    const stats: HomeStats = {
      bornToday: r?.born_today ?? 0,
      explorationsToday: r?.explorations_today ?? 0,
      soulCardsTotal: r?.soul_cards_total ?? 0,
      collectorsTotal: r?.collectors_total ?? 0,
    };
    cache = { stats, expiresAt: now + CACHE_TTL_MS };
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    console.error("[api/home/stats] failed:", err);
    // 只读展示接口：失败返回 null（前端静默降级不渲染）
    return NextResponse.json({ ok: true, stats: null });
  }
}
