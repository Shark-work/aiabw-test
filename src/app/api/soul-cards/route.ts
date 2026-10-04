import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import { listMySoulCards } from "@/server/services/soul-card-service";

export const runtime = "nodejs";

/**
 * GET /api/soul-cards（Bearer 鉴权）
 * Controller：灵魂卡图鉴页数据源 —— 我的灵魂卡列表。
 * 唤醒即铸卡（2026-10-14）：领养时自动铸造，不再存在「可铸造宠物」概念，
 * 响应不再携带 mintablePets；业务规则全部在 service 层，本层只做鉴权/编排/响应。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, code: "SIGN_IN_REQUIRED", error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }

  try {
    await ensureDbSchemaOnce();
    const cards = await listMySoulCards(user.id);
    return NextResponse.json({ ok: true, cards });
  } catch (err) {
    console.error("[/api/soul-cards GET] failed:", err);
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", error: apiError(locale, "soulCardLoadFailed") },
      { status: 500 },
    );
  }
}
