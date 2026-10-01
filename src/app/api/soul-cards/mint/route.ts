import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import { soulCardErrorResponse } from "@/server/http/soul-card-error";
import { mintSoulCard } from "@/server/services/soul-card-service";

export const runtime = "nodejs";
// evm 模式下需等待 Sepolia 出块确认（约 15-30s），放宽函数执行上限
export const maxDuration = 60;

/**
 * POST /api/soul-cards/mint（Bearer 鉴权）
 * Controller：铸造灵魂卡（Mint 增发，链上总量 +1）。
 * Body: { petId: string, name?: string }
 * 业务错误码（见 soul-card-error.ts 映射）：
 *  PET_NOT_FOUND 404 / PET_NOT_OWNED 403 / PET_NOT_ACTIVE 409 /
 *  SOUL_CARD_EXISTS 409 / SUPPLY_EXHAUSTED 409
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, code: "SIGN_IN_REQUIRED", error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }

  let body: { petId?: unknown; name?: unknown };
  try {
    body = (await req.json()) as { petId?: unknown; name?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", error: apiError(locale, "petIdRequired") },
      { status: 400 },
    );
  }
  const petId = typeof body.petId === "string" ? body.petId.trim() : "";
  if (!petId) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", error: apiError(locale, "petIdRequired") },
      { status: 400 },
    );
  }
  const name = typeof body.name === "string" ? body.name : undefined;

  try {
    await ensureDbSchemaOnce();
    const card = await mintSoulCard({ userId: user.id, petId, name });
    return NextResponse.json({ ok: true, card });
  } catch (err) {
    const business = soulCardErrorResponse(err, locale);
    if (business) return business;
    console.error("[/api/soul-cards/mint POST] failed:", err);
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", error: apiError(locale, "soulCardMintFailed") },
      { status: 500 },
    );
  }
}
