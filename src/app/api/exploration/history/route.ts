import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { explorationRecords } from "@/db/schema";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import { deserializeResultData } from "@/lib/exploration-engine";

export const runtime = "nodejs";

/**
 * GET /api/exploration/history?limit=20&offset=0
 * 返回当前登录用户最近的探索记录（按 created_at DESC）。
 * - 必须登录：游客无 userId。
 * - limit 默认 20，最大 100；offset 默认 0。
 * - result_data 字段会反序列化为 title/description/emoji/rarity/knowledgeId。
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

    const url = new URL(req.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));

    const rows = await db
      .select({
        id: explorationRecords.id,
        petId: explorationRecords.petId,
        eventId: explorationRecords.eventId,
        resultType: explorationRecords.resultType,
        resultData: explorationRecords.resultData,
        stepsGained: explorationRecords.stepsGained,
        distanceGained: explorationRecords.distanceGained,
        isRare: explorationRecords.isRare,
        createdAt: explorationRecords.createdAt,
      })
      .from(explorationRecords)
      .where(eq(explorationRecords.userId, user.id))
      .orderBy(desc(explorationRecords.createdAt))
      .limit(limit)
      .offset(offset);

    const records = rows.map((r) => {
      const meta = deserializeResultData(r.resultData);
      return {
        id: r.id,
        petId: r.petId,
        eventId: r.eventId,
        resultType: r.resultType,
        title: meta.title,
        description: meta.description,
        emoji: meta.emoji,
        rarity: meta.rarity,
        knowledgeId: meta.knowledgeId,
        stepsGained: r.stepsGained,
        distanceGained: Number(r.distanceGained),
        isRare: r.isRare,
        createdAt: r.createdAt,
      };
    });

    return NextResponse.json({ ok: true, records, limit, offset });
  } catch (err) {
    console.error("[/api/exploration/history] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(resolveLocale(req), "explorationHistoryFailed") },
      { status: 500 },
    );
  }
}
