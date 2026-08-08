import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword, signToken } from "@/lib/auth";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/register
 * 请求体：{ email, password }
 * 注册成功返回 { ok, token, user }。
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ ok: false, error: "邮箱格式不正确" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ ok: false, error: "密码至少 6 位" }, { status: 400 });
    }

    await ensureDbSchemaOnce();

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing) {
      return NextResponse.json({ ok: false, error: "该邮箱已注册，请直接登录" }, { status: 409 });
    }

    const [user] = await db
      .insert(users)
      .values({ email, passwordHash: hashPassword(password) })
      .returning({ id: users.id, email: users.email });

    const token = await signToken({ id: user.id, email: user.email });
    return NextResponse.json({ ok: true, token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error("[auth/register] failed:", err);
    return NextResponse.json({ ok: false, error: "注册失败，请稍后重试" }, { status: 500 });
  }
}
