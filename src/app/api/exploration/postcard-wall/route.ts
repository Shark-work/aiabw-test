import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db, pool, ensureDbSchemaOnce } from "@/db/client";
import { achievements, pointsLog, users } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { deserializeResultData } from "@/lib/exploration-engine";
import {
  POSTCARD_BADGE_PREFIX,
  POSTCARD_SET_REWARD_POINTS,
  postcardSetBadgeId,
} from "@/lib/postcard-config";

export const runtime = "nodejs";

/**
 * GET /api/exploration/postcard-wall — 明信片墙（P1 故事外显 · 改动四）
 * （路径刻意避开 V1 遗产 /api/exploration/postcards——该路由已随迁移步骤 4 删除，
 *   tests/exploration-v2.test.mjs #21 锁定其不复存在。）
 * 响应：{ ok, cards, collections }
 *  - cards：当前用户全部明信片（exploration_records result_type='postcard'，
 *    按时间倒序；故事文本由 result_data 反序列化，与 history 同口径）；
 *  - collections：系列集齐进度（系列 = exploration_events.pet_category；
 *    owned = 用户已触发的该系列 postcard 事件去重数；claimed 读 achievements）。
 *
 * POST /api/exploration/postcard-wall — 领取系列集齐图鉴奖励
 * 请求体：{ category }
 *  - 服务端权威重算集齐（不信任前端计数）：未集齐 400 setIncomplete；
 *  - 幂等：achievements（badge_id='postcard-<category>'）ON CONFLICT DO NOTHING
 *    → 已领取 409 alreadyClaimed（users.points + points_log 同事务入账）。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "notSignedIn") },
      { status: 401 },
    );
  }

  try {
    await ensureDbSchemaOnce();
    const [cardsRes, setsRes, claimedRes] = await Promise.all([
      pool.query(
        `SELECT r.id, r.event_id AS "eventId", r.result_data AS "resultData",
                r.is_rare AS "isRare", r.created_at AS "createdAt",
                e.pet_category AS "category"
           FROM exploration_records r
           LEFT JOIN exploration_events e ON e.id = r.event_id
          WHERE r.user_id = $1 AND r.result_type = 'postcard'
          ORDER BY r.created_at DESC
          LIMIT 200`,
        [user.id],
      ),
      pool.query(
        `SELECT e.pet_category AS "category", count(*)::int AS total
           FROM exploration_events e
          WHERE e.event_type = 'postcard'
          GROUP BY e.pet_category`,
      ),
      db
        .select({ badgeId: achievements.badgeId })
        .from(achievements)
        .where(eq(achievements.userId, user.id)),
    ]);

    const cards = cardsRes.rows.map((r) => {
      const meta = deserializeResultData(r.resultData);
      return {
        id: String(r.id),
        eventId: r.eventId ? String(r.eventId) : null,
        category: r.category ? String(r.category) : null,
        title: meta.title,
        description: meta.description,
        emoji: meta.emoji,
        rarity: meta.rarity,
        isRare: !!r.isRare,
        createdAt: r.createdAt,
      };
    });

    const claimed = new Set(
      claimedRes
        .map((r) => r.badgeId)
        .filter((b) => b.startsWith(POSTCARD_BADGE_PREFIX)),
    );
    // 按系列去重计数（event_id 维度）
    const eventsByCategory = new Map<string, Set<string>>();
    for (const row of cardsRes.rows) {
      if (!row.category || !row.eventId) continue;
      const cat = String(row.category);
      if (!eventsByCategory.has(cat)) eventsByCategory.set(cat, new Set());
      eventsByCategory.get(cat)!.add(String(row.eventId));
    }

    const collections = setsRes.rows.map((s) => {
      const category = String(s.category);
      const total = Number(s.total);
      const owned = eventsByCategory.get(category)?.size ?? 0;
      return {
        category,
        total,
        owned,
        complete: owned >= total && total > 0,
        claimed: claimed.has(postcardSetBadgeId(category)),
        rewardPoints: POSTCARD_SET_REWARD_POINTS,
      };
    });

    return NextResponse.json({ ok: true, cards, collections });
  } catch (err) {
    console.error("[/api/exploration/postcards GET] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "explorationHistoryFailed") },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "notSignedIn") },
      { status: 401 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const category =
    typeof body?.category === "string" ? body.category.trim() : "";
  if (!category) {
    return NextResponse.json(
      { ok: false, code: "INVALID_SET", error: apiError(locale, "postcardSetInvalid") },
      { status: 400 },
    );
  }

  try {
    await ensureDbSchemaOnce();

    // 服务端权威重算集齐（不信任前端计数）
    const [setRes, ownedRes] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS total
           FROM exploration_events
          WHERE event_type = 'postcard' AND pet_category = $1`,
        [category],
      ),
      pool.query(
        `SELECT count(DISTINCT r.event_id)::int AS owned
           FROM exploration_records r
           JOIN exploration_events e ON e.id = r.event_id
          WHERE r.user_id = $1 AND r.result_type = 'postcard' AND e.pet_category = $2`,
        [user.id, category],
      ),
    ]);
    const total = Number(setRes.rows[0]?.total ?? 0);
    if (total === 0) {
      return NextResponse.json(
        { ok: false, code: "INVALID_SET", error: apiError(locale, "postcardSetInvalid") },
        { status: 400 },
      );
    }
    const owned = Number(ownedRes.rows[0]?.owned ?? 0);
    if (owned < total) {
      return NextResponse.json(
        {
          ok: false,
          code: "SET_INCOMPLETE",
          error: apiError(locale, "postcardSetIncomplete"),
          owned,
          total,
        },
        { status: 400 },
      );
    }

    // 事务性领取（复用 achievements 表：badge_id='postcard-<category>'，
    // UNIQUE(user_id,badge_id) + ON CONFLICT DO NOTHING → 重复/并发幂等）
    const badgeId = postcardSetBadgeId(category);
    const credited = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(achievements)
        .values({ userId: user.id, badgeId, progress: total })
        .onConflictDoNothing()
        .returning({ id: achievements.id });
      if (inserted.length === 0) return false;
      await tx
        .update(users)
        .set({ points: sql`${users.points} + ${POSTCARD_SET_REWARD_POINTS}` })
        .where(eq(users.id, user.id));
      await tx
        .insert(pointsLog)
        .values({ userId: user.id, amount: POSTCARD_SET_REWARD_POINTS, reason: "achievement" });
      return true;
    });

    if (!credited) {
      return NextResponse.json(
        { ok: false, code: "ALREADY_CLAIMED", error: apiError(locale, "postcardSetClaimed") },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      category,
      badgeId,
      rewardPoints: POSTCARD_SET_REWARD_POINTS,
    });
  } catch (err) {
    console.error("[/api/exploration/postcards POST] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "postcardSetClaimFailed") },
      { status: 500 },
    );
  }
}

