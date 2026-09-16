import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { userSubscriptions } from "@/db/schema";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * POST /api/subscription/cancel
 *  - 关闭 auto_renew；当前周期内仍有效
 *  - status 仍为 'active'（直到自然到期）
 *  - 仅作用于当前用户的 active 订阅
 */
export async function POST(req: Request) {
  await ensureDbSchemaOnce();
  const locale = resolveLocale(req);

  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }

  try {
    const result = await db
      .update(userSubscriptions)
      .set({ autoRenew: false })
      .where(
        and(
          eq(userSubscriptions.userId, user.id),
          eq(userSubscriptions.status, "active"),
          gt(userSubscriptions.expiresAt, new Date()),
        ),
      );

    return NextResponse.json({ ok: true, autoRenew: false, affected: result.rowCount ?? 0 });
  } catch (err) {
    console.error("[subscription/cancel] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "subscriptionCancelFailed") },
      { status: 500 },
    );
  }
}
