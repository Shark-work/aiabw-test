import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce, pool } from "@/db/client";
import { users } from "@/db/schema";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import { todayString } from "@/lib/chat-quota-config";
import { getMaxExplorations } from "@/lib/exploration-engine";
import { getActiveSubscription } from "@/lib/subscription-config";
import { isPremium } from "@/lib/premium";

export const runtime = "nodejs";

/**
 * GET /api/exploration/quota
 * 返回当前登录用户的探索配额快照：{ todayCount, maxCount, isVip }。
 *
 * 背景（2026-09 修复）：登录 token 只存于 localStorage（aiabw_token），SSR 页面
 * 无法感知登录态，/explore-v2 的首屏配额改由客户端挂载后经本接口 Bearer 拉取。
 * 计算逻辑与 POST /api/exploration/start 保持一致（VIP = 订阅 || premium || 解锁）。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        code: "SIGN_IN_REQUIRED",
        error: apiError(locale, "signInFirst"),
      },
      { status: 401 },
    );
  }

  try {
    await ensureDbSchemaOnce();

    const [userRow] = await db
      .select({
        premiumUntil: users.premiumUntil,
        isUnlocked: users.isUnlocked,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const activeSub = await getActiveSubscription(user.id);
    const isVip =
      !!activeSub ||
      isPremium(userRow?.premiumUntil ?? null) ||
      (userRow?.isUnlocked ?? false);
    const maxCount = getMaxExplorations(isVip);

    const today = todayString();
    const todayRes = (await pool.query(
      `SELECT count(*)::int AS count
         FROM exploration_records
        WHERE user_id = $1
          AND created_at >= (now() - interval '24 hours')
          AND to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') = $2`,
      [user.id, today],
    )) as { rows: Array<{ count: number }> };
    const todayCount = todayRes.rows[0]?.count ?? 0;

    return NextResponse.json({ ok: true, todayCount, maxCount, isVip });
  } catch (err) {
    console.error("[/api/exploration/quota] failed:", err);
    return NextResponse.json(
      {
        ok: false,
        code: "SERVER_ERROR",
        error: apiError(locale, "explorationHistoryFailed"),
      },
      { status: 500 },
    );
  }
}
