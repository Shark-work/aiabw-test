import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import {
  listMintablePets,
  listMySoulCards,
} from "@/server/services/soul-card-service";

export const runtime = "nodejs";

/**
 * GET /api/soul-cards（Bearer 鉴权）
 * Controller：灵魂卡图鉴页数据源 —— 我的灵魂卡列表 + 可铸造宠物列表。
 * 业务规则全部在 service 层，本层只做鉴权/编排/响应。
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
    const [cards, mintablePets] = await Promise.all([
      listMySoulCards(user.id),
      listMintablePets(user.id),
    ]);
    return NextResponse.json({ ok: true, cards, mintablePets });
  } catch (err) {
    console.error("[/api/soul-cards GET] failed:", err);
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", error: apiError(locale, "soulCardLoadFailed") },
      { status: 500 },
    );
  }
}
