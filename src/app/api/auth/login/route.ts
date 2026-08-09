import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { users } from "@/db/schema";
import { signToken, verifyPassword } from "@/lib/auth";
import { timer } from "@/lib/perf";

export const runtime = "nodejs";

/**
 * POST /api/auth/login
 * 请求体：{ email, password }
 * 登录成功返回 { ok, token, user }。
 */
export async function POST(req: Request) {
  const perf = timer("login");
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ ok: false, error: "请输入邮箱和密码" }, { status: 400 });
    }

    await ensureDbSchemaOnce();
    perf("ensureSchema");

    const [user] = await db
      .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ ok: false, error: "邮箱或密码错误" }, { status: 401 });
    }

    const token = await signToken({ id: user.id, email: user.email });
    perf("signToken");
    return NextResponse.json({ ok: true, token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error("[auth/login] failed:", err);
    return NextResponse.json({ ok: false, error: "登录失败，请稍后重试" }, { status: 500 });
  }
}
