import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword, signToken } from "@/lib/auth";
import {
  creditInviteReward,
  findUserByInviteCode,
} from "@/lib/referral-reward";
import { generateInviteCode, getClientIp } from "@/lib/referral";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { timer } from "@/lib/perf";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/register
 * 请求体：{ email, password, ref?, deviceId? }
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
    const password = typeof body?.password === "string" ? body.password : "";
    const ref = typeof body?.ref === "string" ? body.ref.trim().toLowerCase() : "";
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "invalidEmail") }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "passwordTooShort") }, { status: 400 });
    }

    await ensureDbSchemaOnce();
    perf("ensureSchema");
    dbg["ensure"] = Date.now() - start;

    // 生成唯一邀请码（email 重复 → 409；邀请码撞车 → 重试）
    const passwordHash = await hashPassword(password);
    dbg["hash"] = Date.now() - start;
    let user: { id: string; email: string; inviteCode: string | null } | null = null;
    let inserted = false;
    for (let attempt = 0; attempt < 6 && !inserted; attempt++) {
      const inviteCode = generateInviteCode();
      try {
        const [u] = await db
          .insert(users)
          .values({ email, passwordHash, inviteCode })
          .returning({ id: users.id, email: users.email, inviteCode: users.inviteCode });
        if (u) {
          user = u;
          inserted = true;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        const isEmailDup = /users_email_key|duplicate key value violates unique constraint/i.test(msg) && !/invite_code/i.test(msg);
        const isInviteCodeDup = /users_invite_code_key|invite_code/i.test(msg);
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

    // 邀请绑定 + 奖励（防刷：同 IP / 同设备指纹最多一次）
    let invitedBy: string | null = null;
    let inviteRewardCredited = false;
    if (ref) {
      const inviter = await findUserByInviteCode(ref);
      if (inviter && inviter.id !== user.id) {
        invitedBy = inviter.id;
        await db.update(users).set({ invitedBy: inviter.id }).where(eq(users.id, user.id));
        const res = await creditInviteReward({
          inviterId: inviter.id,
          invitedUserId: user.id,
          ip: getClientIp(req),
          deviceId,
        });
        inviteRewardCredited = res.credited;
        dbg["invite"] = Date.now() - start;
      }
    }

    const token = await signToken({ id: user.id, email: user.email });
    perf("signToken");
    dbg["sign"] = Date.now() - start;
    dbg["total"] = Date.now() - start;
    return NextResponse.json({
      ok: true,
      token,
      user: { id: user.id, email: user.email, inviteCode: user.inviteCode ?? null },
      invitedBy,
      inviteRewardCredited,
      dbg,
    });
  } catch (err) {
    console.error("[auth/register] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "registerFailed") }, { status: 500 });
  }
}
