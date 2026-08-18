import { NextResponse } from "next/server";
import { and, eq, isNull, not, or, sql } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { users, pointsLog } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

/** 每日签到积分 */
const CHECKIN_POINTS = 10;

/** 今天日期（服务器本地时区，YYYY-MM-DD） */
function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * POST /api/user/checkin
 * 请求头：Authorization: Bearer <token>
 * 每日签到：+10 积分，一天一次。
 */
export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Please sign in first" }, { status: 401 });
    }

    await ensureDbSchemaOnce();
    const t = today();

    // 原子更新：仅当上次签到日期不是今天（或从未签到）时 +10 积分
    const res = await db
      .update(users)
      .set({ points: sql`${users.points} + ${CHECKIN_POINTS}`, lastCheckinDate: t })
      .where(
        and(
          eq(users.id, user.id),
          or(isNull(users.lastCheckinDate), not(eq(users.lastCheckinDate, t))),
        ),
      );

    const already = res.rowCount === 0;
    if (!already) {
      // 记录积分流水
      await db.insert(pointsLog).values({ userId: user.id, amount: CHECKIN_POINTS, reason: "checkin" });
    }
    const [me] = await db
      .select({ points: users.points, lastCheckinDate: users.lastCheckinDate })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    return NextResponse.json({
      ok: true,
      already,
      points: me?.points ?? 0,
      checkinDate: t,
    });
  } catch (err) {
    console.error("[user/checkin] failed:", err);
    return NextResponse.json({ ok: false, error: "Check-in failed, please try again" }, { status: 500 });
  }
}
