import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { users, pointsLog } from "@/db/schema";
import { hashPassword, signToken } from "@/lib/auth";
import {
  createPendingInviteReward,
  findUserByInviteCode,
} from "@/lib/referral-reward";
import { generateInviteCode, getClientIp, WELCOME_BONUS_POINTS } from "@/lib/referral";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { timer } from "@/lib/perf";
import { redactSensitive, validateUsername } from "@/lib/privacy";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/register
 * 请求体：{ username, email, password, ref?, deviceId? }
 *  - username：站内唯一公开昵称（必填；排行榜/广场展示；不允许使用邮箱格式）
 *  - email：仅用于密码找回/安全通知等后端用途，不在任何前端页面/公开 API 展示
 *  - ref：邀请码（来自 www.aiabw.com/<locale>/register?ref=XXX）
 *  - deviceId：设备指纹（前端 getAnonymousId()，用于防刷）
 * 注册成功返回 { ok, token, user }；若 ref 有效，绑定 invited_by 并给邀请人 +50 积分（防刷）。
 */
export async function POST(req: Request) {
  const perf = timer("register");
  const start = Date.now();
  const dbg: Record<string, number> = {};
  try {
    const body = await req.json().catch(() => ({}));
    dbg["json"] = Date.now() - start;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const ref = typeof body?.ref === "string" ? body.ref.trim().toLowerCase() : "";
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";

    // 昵称：站内唯一公开标识，必填且不能是邮箱格式/系统保留名
    const nameCheck = validateUsername(username);
    if (!nameCheck.ok) {
      const key = nameCheck.reason === "required" ? "usernameRequired" : "usernameInvalid";
      return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), key) }, { status: 400 });
    }
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "invalidEmail") }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "passwordTooShort") }, { status: 400 });
    }

    await ensureDbSchemaOnce();
    perf("ensureSchema");
    dbg["ensure"] = Date.now() - start;

    // 生成唯一邀请码（email/username 重复 → 409；邀请码撞车 → 重试）
    const passwordHash = await hashPassword(password);
    dbg["hash"] = Date.now() - start;
    let user: { id: string; username: string | null; inviteCode: string | null } | null = null;
    let inserted = false;
    for (let attempt = 0; attempt < 6 && !inserted; attempt++) {
      const inviteCode = generateInviteCode();
      try {
        const [u] = await db
          .insert(users)
          .values({ email, username, passwordHash, inviteCode })
          .returning({ id: users.id, username: users.username, inviteCode: users.inviteCode });
        if (u) {
          user = u;
          inserted = true;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        const isUsernameDup = /users_username_key/i.test(msg);
        const isInviteCodeDup = /users_invite_code_key|invite_code/i.test(msg);
        const isEmailDup =
          /users_email_key|duplicate key value violates unique constraint/i.test(msg) &&
          !isUsernameDup &&
          !isInviteCodeDup;
        if (isUsernameDup) {
          return NextResponse.json(
            { ok: false, error: apiError(resolveLocale(req), "usernameTaken") },
            { status: 409 },
          );
        }
        if (isEmailDup) {
          return NextResponse.json(
            { ok: false, error: apiError(resolveLocale(req), "emailRegistered") },
            { status: 409 },
          );
        }
        if (!isInviteCodeDup) throw err;
        // 邀请码撞车：重试生成新码
      }
    }
    if (!user) {
      throw new Error("failed to allocate invite code after retries");
    }
    dbg["insert"] = Date.now() - start;

    // 邀请绑定 + 冻结奖励（防刷：同 IP / 同设备指纹 24h 内 ≤3 次；被邀请人活跃后发放）
    let invitedBy: string | null = null;
    let invitePending = false;
    if (ref) {
      const inviter = await findUserByInviteCode(ref);
      if (inviter && inviter.id !== user.id) {
        invitedBy = inviter.id;
        await db.update(users).set({ invitedBy: inviter.id }).where(eq(users.id, user.id));
        const res = await createPendingInviteReward({
          inviterId: inviter.id,
          invitedUserId: user.id,
          ip: getClientIp(req),
          deviceId,
        });
        invitePending = res.ok;
        dbg["invite"] = Date.now() - start;
      }
    }

    // 新手礼包：注册即 +20 积分（points_log reason='welcome'）
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ points: sql`${users.points} + ${WELCOME_BONUS_POINTS}` })
        .where(eq(users.id, user.id));
      await tx
        .insert(pointsLog)
        .values({ userId: user.id, amount: WELCOME_BONUS_POINTS, reason: "welcome" });
    });

    // JWT 内部携带 email 仅供后端鉴权上下文使用（不下发展示；API 响应只含公开昵称）
    const token = await signToken({ id: user.id, email });
    perf("signToken");
    dbg["sign"] = Date.now() - start;
    dbg["total"] = Date.now() - start;
    return NextResponse.json({
      ok: true,
      token,
      user: { id: user.id, username: user.username ?? username, inviteCode: user.inviteCode ?? null },
      invitedBy,
      invitePending,
      welcomeBonus: WELCOME_BONUS_POINTS,
      dbg,
    });
  } catch (err) {
    // 日志脱敏：PG 错误详情可能携带 email/唯一键内容，掩码后再输出
    console.error("[auth/register] failed:", redactSensitive(err instanceof Error ? err.message : String(err)));
    return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "registerFailed") }, { status: 500 });
  }
}
