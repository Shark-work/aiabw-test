import { NextResponse } from "next/server";
import { and, desc, eq, type SQL } from "drizzle-orm";

import { db, ensureDbSchemaOnce, pool } from "@/db/client";
import { explorationRecords } from "@/db/schema";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import {
  deserializeResultData,
  EVENT_TYPES,
  type EventType,
} from "@/lib/exploration-engine";

export const runtime = "nodejs";

/**
 * GET /api/exploration/history?limit=20&offset=0&type=<eventType>&rare=1
 * 返回当前登录用户最近的探索记录（按 created_at DESC）。
 * - 必须登录：游客无 userId。
 * - limit 默认 20，最大 100；offset 默认 0。
 * - result_data 字段会反序列化为 title/description/emoji/rarity/knowledgeId。
 * - Phase 3 新增：
 *   - type：按事件类型筛选（postcard/gift/knowledge/encounter/rest，非法值忽略）
 *   - rare=1：只看稀有（is_rare = true，即 rare/epic）
 *   - stats：用户全量统计（总次数/稀有次数/总步数/总距离；不受筛选影响）
 */
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(resolveLocale(req), "notSignedIn") },
      { status: 401 },
    );
  }

  try {
    await ensureDbSchemaOnce();

    const url = new URL(req.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
    const typeParam = url.searchParams.get("type");
    const typeFilter: EventType | null = EVENT_TYPES.includes(typeParam as EventType)
      ? (typeParam as EventType)
      : null;
    const rareOnly = url.searchParams.get("rare") === "1";

    const conditions: SQL[] = [eq(explorationRecords.userId, user.id)];
    if (typeFilter) conditions.push(eq(explorationRecords.resultType, typeFilter));
    if (rareOnly) conditions.push(eq(explorationRecords.isRare, true));

    const [rows, statsRes] = await Promise.all([
      db
        .select({
          id: explorationRecords.id,
          petId: explorationRecords.petId,
          eventId: explorationRecords.eventId,
          resultType: explorationRecords.resultType,
          resultData: explorationRecords.resultData,
          stepsGained: explorationRecords.stepsGained,
          distanceGained: explorationRecords.distanceGained,
          isRare: explorationRecords.isRare,
          createdAt: explorationRecords.createdAt,
        })
        .from(explorationRecords)
        .where(and(...conditions))
        .orderBy(desc(explorationRecords.createdAt))
        .limit(limit)
        .offset(offset),
      // 全量统计（筛选无关）：总次数 / 稀有次数 / 总步数 / 总距离
      pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE is_rare)::int AS "rareCount",
                coalesce(sum(steps_gained), 0)::int AS "totalSteps",
                coalesce(round(sum(distance_gained)::numeric, 2), 0)::float8 AS "totalDistance"
           FROM exploration_records
          WHERE user_id = $1`,
        [user.id],
      ) as Promise<{
        rows: Array<{
          total: number;
          rareCount: number;
          totalSteps: number;
          totalDistance: number;
        }>;
      }>,
    ]);

    const records = rows.map((r) => {
      const meta = deserializeResultData(r.resultData);
      return {
        id: r.id,
        petId: r.petId,
        eventId: r.eventId,
        resultType: r.resultType,
        title: meta.title,
        description: meta.description,
        emoji: meta.emoji,
        rarity: meta.rarity,
        knowledgeId: meta.knowledgeId,
        stepsGained: r.stepsGained,
        distanceGained: Number(r.distanceGained),
        isRare: r.isRare,
        createdAt: r.createdAt,
      };
    });

    const stats = statsRes.rows[0] ?? {
      total: 0,
      rareCount: 0,
      totalSteps: 0,
      totalDistance: 0,
    };

    return NextResponse.json({
      ok: true,
      records,
      stats,
      limit,
      offset,
      filter: { type: typeFilter, rareOnly },
    });
  } catch (err) {
    console.error("[/api/exploration/history] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(resolveLocale(req), "explorationHistoryFailed") },
      { status: 500 },
    );
  }
}
