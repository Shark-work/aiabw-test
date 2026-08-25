import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { signToken, verifyPassword } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { timer } from "@/lib/perf";
import {
  captchaRequiredFor,
  clearLockAndTouchLogin,
  ipRateLimited,
  isAccountLocked,
  issueCaptcha,
  lockAccount,
  recordFailedLogin,
  recordIpAttempt,
  recordIpFail,
  resetIpFails,
  verifyCaptcha,
} from "@/lib/login-security";

export const runtime = "nodejs";

/**
 * POST /api/auth/login
 * 请求体：{ email, password, captchaId?, captchaAnswer? }
 * 防暴力破解：
 *  - 同一 IP 1 分钟最多 5 次 → 429；
 *  - 同一账号连续 5 次失败 → 锁定 30 分钟；
 *  - 同一 IP 累计失败 10 次 → 要求数学验证码；
 *  - 失败尝试写入 login_attempts（审计）。
 */
export async function POST(req: Request) {
  const perf = timer("login");
  const start = Date.now();
  const dbg: Record<string, number> = {};
  try {
    // 1) IP 频率限制（1 分钟 5 次）
    const limit = ipRateLimited(req);
    if (limit.limited) {
      return NextResponse.json(
        { ok: false, error: "尝试次数过多，请 60 秒后再试", retryAfterSec: limit.retryAfterSec },
        { status: 429 },
      );
    }
    recordIpAttempt(req);

    const body = await req.json().catch(() => ({}));
    dbg["json"] = Date.now() - start;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "emailPasswordRequired") }, { status: 400 });
    }

    // 2) IP 累计失败达到阈值 → 验证码校验
    if (captchaRequiredFor(req)) {
      const ok = verifyCaptcha(body?.captchaId, body?.captchaAnswer);
      if (!ok) {
        const cap = issueCaptcha();
        return NextResponse.json(
          { ok: false, error: "请输入验证码", captchaRequired: true, ...cap },
          { status: 400 },
        );
      }
    }

    const [user] = await db
      .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    dbg["select"] = Date.now() - start;

    // 3) 账户锁定检查
    if (user) {
      const locked = await isAccountLocked(user.id);
      if (locked.locked) {
        return NextResponse.json(
          { ok: false, error: "账号已被临时锁定，请 30 分钟后再试", minutesLeft: locked.minutesLeft },
          { status: 429 },
        );
      }
    }

    // 4) 密码校验
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      recordIpFail(req);
      if (user) {
        const shouldLock = await recordFailedLogin(req, email);
        if (shouldLock) await lockAccount(user.id);
      }
      return NextResponse.json(
        {
          ok: false,
          error: apiError(resolveLocale(req), "badCredentials"),
          captchaRequired: captchaRequiredFor(req),
        },
        { status: 401 },
      );
    }
    dbg["verify"] = Date.now() - start;

    // 5) 成功：清锁定 + 记录最后登录时间 + 重置 IP 失败计数
    await clearLockAndTouchLogin(user.id);
    resetIpFails(req);

    const token = await signToken({ id: user.id, email: user.email });
    perf("signToken");
    dbg["sign"] = Date.now() - start;
    dbg["total"] = Date.now() - start;
    return NextResponse.json({ ok: true, token, user: { id: user.id, email: user.email }, dbg });
  } catch (err) {
    console.error("[auth/login] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "loginFailed") }, { status: 500 });
  }
}

