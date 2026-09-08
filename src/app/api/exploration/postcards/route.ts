import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { userPostcards } from "@/db/schema";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/exploration/postcards
 * 返回当前登录用户的全部明信片（按时间倒序）。
 * 必须登录：游客无 userId，无法关联 user_postcards。
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

    const rows = await db
      .select({
        id: userPostcards.id,
        mapId: userPostcards.mapId,
        mapNameZh: userPostcards.mapNameZh,
        mapNameEn: userPostcards.mapNameEn,
        aiSummaryZh: userPostcards.aiSummaryZh,
        aiSummaryEn: userPostcards.aiSummaryEn,
        illustrationEmoji: userPostcards.illustrationEmoji,
        createdAt: userPostcards.createdAt,
      })
      .from(userPostcards)
      .where(eq(userPostcards.userId, user.id))
      .orderBy(desc(userPostcards.createdAt))
      .limit(60);

    return NextResponse.json({ ok: true, postcards: rows });
  } catch (err) {
    console.error("[/api/exploration/postcards] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(resolveLocale(req), "itemsLoadFailed") },
      { status: 500 },
    );
  }
}