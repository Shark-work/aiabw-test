import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import {
  getSoulCardDetail,
  listLegacyAibiTokens,
} from "@/server/services/soul-card-service";

export const runtime = "nodejs";

/**
 * GET /api/soul-cards/[id]（公开读）
 * Controller：灵魂卡详情 + 完整链上轨迹（mint/transfer/burn 账本）。
 * 公开可读 = 稀缺凭证的可验证性（不返回任何用户隐私字段，
 * 持有人仅以链上地址形式存在于账本记录中）。
 * P0 概念收敛：请求者（Bearer）为卡主本人时附带 legacyTokens
 * （该用户的历史艾比凭证，只读；公开访问一律不附带，防持有信息泄露）。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const locale = resolveLocale(req);
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", error: apiError(locale, "soulCardNotFound") },
      { status: 400 },
    );
  }

  try {
    await ensureDbSchemaOnce();
    const detail = await getSoulCardDetail(id);
    if (!detail) {
      return NextResponse.json(
        { ok: false, code: "CARD_NOT_FOUND", error: apiError(locale, "soulCardNotFound") },
        { status: 404 },
      );
    }
    // 历史凭证（艾比时代）：仅卡主本人可见；公开访问为 null
    const user = await getUserFromRequest(req);
    const legacyTokens =
      user && detail.card.ownerId === user.id
        ? await listLegacyAibiTokens(user.id)
        : null;
    return NextResponse.json({ ok: true, ...detail, legacyTokens });
  } catch (err) {
    console.error("[/api/soul-cards/[id] GET] failed:", err);
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", error: apiError(locale, "soulCardLoadFailed") },
      { status: 500 },
    );
  }
}
