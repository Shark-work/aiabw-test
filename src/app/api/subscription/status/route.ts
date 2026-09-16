import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import { getActiveSubscription, daysUntilExpiry, expireStaleSubscriptions } from "@/lib/subscription-config";

export const runtime = "nodejs";

/**
 * GET /api/subscription/status
 *  - isVip: 是否有 active 订阅
 *  - planName/expiresAt/daysRemaining/autoRenew
 *  - 顺便清理过期订阅（不影响返回值）
 */
export async function GET(req: Request) {
  await ensureDbSchemaOnce();
  const locale = resolveLocale(req);

  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }

  // 顺手清理过期订阅（幂等，单独 catch 防止雪崩）
  try {
    await expireStaleSubscriptions(user.id);
  } catch (err) {
    console.error("[subscription/status] expireStaleSubscriptions failed:", err);
  }

  const sub = await getActiveSubscription(user.id);
  if (!sub) {
    return NextResponse.json({
      ok: true,
      isVip: false,
      planId: null,
      planName: null,
      expiresAt: null,
      daysRemaining: 0,
      autoRenew: false,
    });
  }

  return NextResponse.json({
    ok: true,
    isVip: true,
    planId: sub.planId,
    planName: sub.planId, // 前端按 i18n 自行翻译
    expiresAt: sub.expiresAt.toISOString(),
    daysRemaining: daysUntilExpiry(sub.expiresAt),
    autoRenew: sub.autoRenew,
  });
}
