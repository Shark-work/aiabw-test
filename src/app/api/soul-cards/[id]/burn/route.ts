import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import { soulCardErrorResponse } from "@/server/http/soul-card-error";
import { burnSoulCard } from "@/server/services/soul-card-service";

export const runtime = "nodejs";
// evm 模式下需等待 Sepolia 出块确认（约 15-30s），放宽函数执行上限
export const maxDuration = 60;

/**
 * POST /api/soul-cards/[id]/burn（Bearer 鉴权）
 * Controller：销毁灵魂卡（Burn 销毁，链上流通量 -1，不可逆）。
 * 仅卡片持有人可操作；宠物本体（pets 行）不受影响。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, code: "SIGN_IN_REQUIRED", error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", error: apiError(locale, "soulCardNotFound") },
      { status: 400 },
    );
  }

  try {
    await ensureDbSchemaOnce();
    const card = await burnSoulCard({ userId: user.id, cardId: id });
    return NextResponse.json({ ok: true, card });
  } catch (err) {
    const business = soulCardErrorResponse(err, locale);
    if (business) return business;
    console.error("[/api/soul-cards/[id]/burn POST] failed:", err);
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", error: apiError(locale, "soulCardBurnFailed") },
      { status: 500 },
    );
  }
}
