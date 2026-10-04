import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { inviteRewards, users } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { INVITE_REWARD_VIP_DAYS } from "@/lib/referral";

export const runtime = "nodejs";

/**
 * GET /api/referral（Bearer 鉴权）
 * 邀请返利概览：我的邀请码 + 累计统计（已邀请/已返利）+ 奖励规则（双方各得 VIP 天数）。
 * 绑定入口见 POST /api/referral/bind（老用户手动填码）；注册带 ref 自动绑定。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }

  try {
    await ensureDbSchemaOnce();
    const [me] = await db
      .select({ inviteCode: users.inviteCode })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const [stats] = await db
      .select({
        invited: sql<number>`count(*)::int`,
        rewarded: sql<number>`count(*) filter (where ${inviteRewards.status} = 'credited')::int`,
      })
      .from(inviteRewards)
      .where(eq(inviteRewards.inviterId, user.id));

    return NextResponse.json({
      ok: true,
      inviteCode: me?.inviteCode ?? null,
      stats: { invited: stats?.invited ?? 0, rewarded: stats?.rewarded ?? 0 },
      vipDays: INVITE_REWARD_VIP_DAYS,
    });
  } catch (err) {
    console.error("[referral GET] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "referralLoadFailed") },
      { status: 500 },
    );
  }
}
