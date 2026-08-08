import { NextResponse } from "next/server";

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
  return NextResponse.json({ ok: true, user });
}
