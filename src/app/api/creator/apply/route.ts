import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { users } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * POST /api/creator/apply
 * 请求头：Authorization: Bearer <token>
 * 已登录用户申请成为创作者（初期直接通过，is_creator=true）。
 */
export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
    }

    await ensureDbSchemaOnce();
    await db
      .update(users)
      .set({ isCreator: true })
      .where(eq(users.id, user.id));

    return NextResponse.json({ ok: true, isCreator: true });
  } catch (err) {
    console.error("[creator/apply] failed:", err);
    return NextResponse.json({ ok: false, error: "申请失败，请稍后重试" }, { status: 500 });
  }
}
