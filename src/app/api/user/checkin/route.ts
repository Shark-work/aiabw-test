import { NextResponse } from "next/server";
import { and, eq, isNull, not, or, sql } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { users, pointsLog } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/** 每日签到积分 */
const CHECKIN_POINTS = 10;
/** 连签 7 天额外奖励积分（成就） */
const CHECKIN_BONUS_POINTS = 100;
/** 连签成就周期 */
const STREAK_BONUS_PERIOD = 7;

/** 日期字符串（本地时区，YYYY-MM-DD） */
function dateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * POST /api/user/checkin
 * 每日签到：+10 积分（一天一次，原子条件更新防并发重复签到）；
 * 连签逻辑：昨天签到过 → streak+1，否则重置为 1；
 * 连签满 7 天 → 额外 +100 积分（成就，points_log reason='checkin_bonus'）。
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }

    await ensureDbSchemaOnce();
    const t = dateStr(new Date());
    const yest = dateStr(new Date(Date.now() - 24 * 60 * 60 * 1000));

    const [me] = await db
      .select({
        points: users.points,
        lastCheckinDate: users.lastCheckinDate,
        checkinStreak: users.checkinStreak,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const already = me?.lastCheckinDate === t;
    if (already) {
      return NextResponse.json({
        ok: true,
        already: true,
        points: me.points ?? 0,
        streak: me.checkinStreak ?? 0,
        checkinDate: t,
      });
    }

    // 连签判定：昨天签到过 → +1，否则重置为 1
    const isConsecutive = me?.lastCheckinDate === yest;
    const newStreak = isConsecutive ? (me?.checkinStreak ?? 0) + 1 : 1;
    const bonus = newStreak % STREAK_BONUS_PERIOD === 0;
    const totalGain = CHECKIN_POINTS + (bonus ? CHECKIN_BONUS_POINTS : 0);

    // 原子更新（数据库级防重复签到）：仅当 lastCheckinDate 不是今天才 +积分
    const res = await db.transaction(async (tx) => {
      const upd = await tx
        .update(users)
        .set({
          points: sql`${users.points} + ${totalGain}`,
          lastCheckinDate: t,
          checkinStreak: newStreak,
        })
        .where(
          and(
            eq(users.id, user.id),
            or(isNull(users.lastCheckinDate), not(eq(users.lastCheckinDate, t))),
          ),
        );
      if (upd.rowCount === 0) return null;
      await tx.insert(pointsLog).values({ userId: user.id, amount: CHECKIN_POINTS, reason: "checkin" });
      if (bonus) {
        await tx.insert(pointsLog).values({ userId: user.id, amount: CHECKIN_BONUS_POINTS, reason: "checkin_bonus" });
      }
      return true;
    });

    if (res === null) {
      // 并发下已被其它请求签到
      const [again] = await db
        .select({ points: users.points, checkinStreak: users.checkinStreak })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      return NextResponse.json({
        ok: true,
        already: true,
        points: again?.points ?? 0,
        streak: again?.checkinStreak ?? 0,
        checkinDate: t,
      });
    }

    return NextResponse.json({
      ok: true,
      already: false,
      points: (me?.points ?? 0) + totalGain,
      streak: newStreak,
      bonus,
      bonusPoints: bonus ? CHECKIN_BONUS_POINTS : 0,
      achieved: bonus ? `checkin_${newStreak}` : null,
      checkinDate: t,
    });
  } catch (err) {
    console.error("[user/checkin] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(locale, "checkinFailed") }, { status: 500 });
  }
}

