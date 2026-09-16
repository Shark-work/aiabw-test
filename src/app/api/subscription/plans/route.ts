import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { subscriptionPlans } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getActiveSubscription } from "@/lib/subscription-config";
import { SUBSCRIPTION_FEATURES } from "@/lib/subscription-config";

export const runtime = "nodejs";

/**
 * GET /api/subscription/plans
 *  - 返回所有 is_active 计划，按 sort_order 升序
 *  - 附带当前用户的订阅状态（已登录）
 *  - features 字符串数组解析为对象
 */
export async function GET(req: Request) {
  await ensureDbSchemaOnce();
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);

  let plans;
  try {
    plans = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.isActive, true))
      .orderBy(asc(subscriptionPlans.sortOrder));
  } catch (err) {
    console.error("[subscription/plans] db select failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "subscriptionStatusFailed") },
      { status: 500 },
    );
  }

  const items = plans.map((p) => {
    let features: string[] = [];
    try {
      features = Array.isArray(p.features)
        ? (p.features as unknown as string[])
        : JSON.parse(String(p.features));
    } catch {
      features = [];
    }
    return {
      id: p.id,
      name: locale === "en" ? p.nameEn : p.nameZh,
      priceRmb: p.priceRmb,
      durationDays: p.durationDays,
      dailyChatLimit: p.dailyChatLimit,
      features,
      badge: locale === "en" ? p.badgeEn : p.badgeZh,
      sortOrder: p.sortOrder,
    };
  });

  // 当前用户订阅状态
  const sub = user ? await getActiveSubscription(user.id) : null;
  const current = sub
    ? {
        planId: sub.planId,
        status: sub.status,
        expiresAt: sub.expiresAt.toISOString(),
        autoRenew: sub.autoRenew,
        daysRemaining: Math.max(
          0,
          Math.floor((sub.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        ),
      }
    : null;

  return NextResponse.json({
    ok: true,
    plans: items,
    current,
    featureKeys: SUBSCRIPTION_FEATURES,
  });
}
