import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { handbooks } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/handbooks
 * 返回当前用户的记忆手账列表（倒序）。
 */
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "signInFirst") }, { status: 401 });
  }

  const rows = await db
    .select({
      id: handbooks.id,
      title: handbooks.title,
      status: handbooks.status,
      createdAt: handbooks.createdAt,
    })
    .from(handbooks)
    .where(eq(handbooks.userId, user.id))
    .orderBy(desc(handbooks.createdAt));

  return NextResponse.json({ ok: true, handbooks: rows });
}
