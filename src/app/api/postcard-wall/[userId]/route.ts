import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getPublicPostcardWall } from "@/server/queries/postcard-wall-queries";

export const runtime = "nodejs";

/**
 * GET /api/postcard-wall/[userId] — 明信片墙公开数据（P2 社交传播 · 改动二）
 *
 * 匿名可读：仅当目标用户开启 postcard_wall_public（设置页开关，默认关）时返回
 * { owner, cards, collections }；未开启/用户不存在一律 404（不泄露开关状态）。
 * 只读：领取奖励走 /api/exploration/postcard-wall POST（本人视角）。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const locale = resolveLocale(req);
  const { userId } = await params;
  try {
    await ensureDbSchemaOnce();
    const wall = await getPublicPostcardWall(userId);
    if (!wall) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "postcardWallNotFound") },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, ...wall });
  } catch (err) {
    console.error("[/api/postcard-wall/[userId]] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "postcardSetClaimFailed") },
      { status: 500 },
    );
  }
}
