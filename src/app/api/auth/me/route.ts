import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/auth/me
 * 携带 Authorization: Bearer <token> 获取当前登录用户信息。
 */
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "未登录或登录已过期" }, { status: 401 });
  }

  const [row] = await db
    .select({
      points: users.points,
      isCreator: users.isCreator,
      creatorBalance: users.creatorBalance,
      lastCheckinDate: users.lastCheckinDate,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      points: row?.points ?? 0,
      isCreator: !!row?.isCreator,
      creatorBalance: row?.creatorBalance ?? 0,
      lastCheckinDate: row?.lastCheckinDate ?? null,
    },
  });
}
