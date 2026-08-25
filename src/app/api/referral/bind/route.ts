import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { users } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { createPendingInviteReward, findUserByInviteCode } from "@/lib/referral-reward";
import { getClientIp } from "@/lib/referral";

export const runtime = "nodejs";

/**
 * POST /api/referral/bind   — 绑定邀请码（老用户手动填码）
 * 请求头：Authorization: Bearer <token>
 * 请求体：{ code: string, deviceId?: string }
 *
 * 规则：
 *  - 不能绑定自己的邀请码；
 *  - 已被邀请过（users.invited_by 非空 或 已有邀请记录）则拒绝；
 *  - 绑定后创建「冻结」奖励（pending，防刷：同 IP/设备 24h 内 ≤3 次），
 *    被邀请人 24h 内完成首次领养后发放 +50。
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
    if (!code) {
      return NextResponse.json({ ok: false, error: apiError(locale, "invalidInviteCode") }, { status: 400 });
    }

    await ensureDbSchemaOnce();

    // 已绑定过则拒绝
    const [me] = await db
      .select({ invitedBy: users.invitedBy })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    if (me?.invitedBy) {
      return NextResponse.json({ ok: false, error: apiError(locale, "alreadyInvited") }, { status: 409 });
    }

    const inviter = await findUserByInviteCode(code);
    if (!inviter) {
      return NextResponse.json({ ok: false, error: apiError(locale, "invalidInviteCode") }, { status: 404 });
    }
    if (inviter.id === user.id) {
      return NextResponse.json({ ok: false, error: apiError(locale, "selfInvite") }, { status: 400 });
    }

    await db.update(users).set({ invitedBy: inviter.id }).where(eq(users.id, user.id));
    const res = await createPendingInviteReward({
      inviterId: inviter.id,
      invitedUserId: user.id,
      ip: getClientIp(req),
      deviceId,
    });

    return NextResponse.json({
      ok: true,
      invitedBy: inviter.id,
      pending: res.ok,
      reason: res.reason,
    });
  } catch (err) {
    console.error("[referral/bind] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(locale, "bindFailed") }, { status: 500 });
  }
}
