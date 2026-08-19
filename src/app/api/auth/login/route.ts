import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { signToken, verifyPassword } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { timer } from "@/lib/perf";

export const runtime = "nodejs";

/**
 * POST /api/auth/login
 * 请求体：{ email, password }
 * 登录成功返回 { ok, token, user }。
 *
 * 性能优化：不再在登录热路径上 await ensureDbSchemaOnce()。
 * 建表/补列/补索引的 DDL 由 db/client.ts 模块加载时的 `void ensureDbSchemaOnce()`
 * 以及 /api/warmup（部署后主动预热一次）负责；登录只做业务查询。
 */
export async function POST(req: Request) {
  const perf = timer("login");
  const start = Date.now();
  const dbg: Record<string, number> = {};
  try {
    const body = await req.json().catch(() => ({}));
    dbg["json"] = Date.now() - start;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "emailPasswordRequired") }, { status: 400 });
    }

    const [user] = await db
      .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    dbg["select"] = Date.now() - start;

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "badCredentials") }, { status: 401 });
    }
    dbg["verify"] = Date.now() - start;

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
