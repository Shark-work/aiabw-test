import { NextResponse } from "next/server";

import { ensureDbSchemaOnce, pool } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import { FIRST_PURCHASE_BONUS_MULTIPLIER } from "@/lib/points-recharge";

export const runtime = "nodejs";

/**
 * GET /api/user/first-purchase/status
 *
 * 首充状态查询（产品升级 Phase 4）：
 *  - isFirstPurchase=true 表示尚未首充（任意积分档位可享双倍，见 FIRST_PURCHASE_BONUS_MULTIPLIER）；
 *  - first_purchase 表 user_id 主键一人一行；双倍发放见 pay/notify points 段；
 *  - 前端用途：/points 档位「首充×2」标签、积分不足弹窗/首充特惠弹窗分派。
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

  const { rows } = await pool.query(
    `SELECT purchased_at AS "purchasedAt",
            points_received AS "pointsReceived",
            bonus_points AS "bonusPoints"
       FROM first_purchase
      WHERE user_id = $1::uuid`,
    [user.id],
  );
  const row = rows[0] as
    | { purchasedAt: Date; pointsReceived: number; bonusPoints: number }
    | undefined;

  return NextResponse.json({
    ok: true,
    isFirstPurchase: !row,
    purchasedAt: row ? row.purchasedAt.toISOString() : null,
    pointsReceived: row?.pointsReceived ?? 0,
    bonusPoints: row?.bonusPoints ?? 0,
    bonusMultiplier: FIRST_PURCHASE_BONUS_MULTIPLIER,
  });
}
