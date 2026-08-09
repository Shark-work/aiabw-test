import { NextResponse } from "next/server";

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

    // 直接插入；邮箱唯一约束冲突(code 23505)时返回 409，省去一次前置查询
    let user: { id: string; email: string };
    try {
      const [u] = await db
        .insert(users)
        .values({ email, passwordHash: hashPassword(password) })
        .returning({ id: users.id, email: users.email });
      user = u;
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } };
      const isDuplicate =
        e?.code === "23505" ||
        e?.cause?.code === "23505" ||
        /duplicate key value violates unique constraint/i.test(
          err instanceof Error ? err.message : "",
        );
      if (isDuplicate) {
        return NextResponse.json(
          { ok: false, error: "该邮箱已注册，请直接登录" },
          { status: 409 },
        );
      }
      throw err;
    }

    const token = await signToken({ id: user.id, email: user.email });
    return NextResponse.json({ ok: true, token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error("[auth/register] failed:", err);
    return NextResponse.json({ ok: false, error: "注册失败，请稍后重试" }, { status: 500 });
  }
}
