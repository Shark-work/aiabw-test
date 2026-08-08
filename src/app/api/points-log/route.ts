import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { pointsLog } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/points-log
 * 返回当前用户的积分流水（倒序，最多 50 条）。
 */
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: pointsLog.id,
      amount: pointsLog.amount,
      reason: pointsLog.reason,
      createdAt: pointsLog.createdAt,
    })
    .from(pointsLog)
    .where(eq(pointsLog.userId, user.id))
    .orderBy(desc(pointsLog.createdAt))
    .limit(50);

  return NextResponse.json({ ok: true, logs: rows });
}
