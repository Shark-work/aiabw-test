import { NextResponse } from "next/server";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword, signToken } from "@/lib/auth";
import { timer } from "@/lib/perf";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/register
 * 请求体：{ email, password }
 * 注册成功返回 { ok, token, user }。
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

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ ok: false, error: "Invalid email format" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ ok: false, error: "Password must be at least 6 characters" }, { status: 400 });
    }

    await ensureDbSchemaOnce();
    perf("ensureSchema");
    dbg["ensure"] = Date.now() - start;

    // 直接插入；邮箱唯一约束冲突(code 23505)时返回 409，省去一次前置查询
    const passwordHash = await hashPassword(password);
    dbg["hash"] = Date.now() - start;
    let user: { id: string; email: string };
    try {
      const [u] = await db
        .insert(users)
        .values({ email, passwordHash })
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
          { ok: false, error: "This email is already registered - please sign in" },
          { status: 409 },
        );
      }
      throw err;
    }
    dbg["insert"] = Date.now() - start;

    const token = await signToken({ id: user.id, email: user.email });
    perf("signToken");
    dbg["sign"] = Date.now() - start;
    dbg["total"] = Date.now() - start;
    return NextResponse.json({ ok: true, token, user: { id: user.id, email: user.email }, dbg });
  } catch (err) {
    console.error("[auth/register] failed:", err);
    return NextResponse.json({ ok: false, error: "Registration failed, please try again" }, { status: 500 });
  }
}
