import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/auth/me
 * 携带 Authorization: Bearer <token> 获取当前登录用户信息。
 * 隐私约定：响应只包含公开昵称 username；email 仅后端用途（找回/通知），不下发前端。
 */
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "sessionExpired") }, { status: 401 });
  }

  const [row] = await db
    .select({
      username: users.username,
      points: users.points,
      role: users.role,
      isCreator: users.isCreator,
      creatorBalance: users.creatorBalance,
      lastCheckinDate: users.lastCheckinDate,
      inviteCode: users.inviteCode,
      showInLeaderboard: users.showInLeaderboard,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      username: row?.username ?? "",
      role: row?.role ?? "user",
      points: row?.points ?? 0,
      isCreator: !!row?.isCreator,
      creatorBalance: row?.creatorBalance ?? 0,
      lastCheckinDate: row?.lastCheckinDate ?? null,
      inviteCode: row?.inviteCode ?? null,
      showInLeaderboard: row?.showInLeaderboard ?? true,
    },
  });
}
