import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { hashPassword } from "@/lib/auth";
import { adminError, requireAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";

/**
 * POST /api/admin/settings/add-admin { email, password }
 * 新增管理员账号（邮箱已存在则拒绝，不覆盖）。
 */
export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || password.length < 6) {
    return NextResponse.json({ ok: false, error: "邮箱或密码格式不正确（密码至少 6 位）" }, { status: 400 });
  }

  try {
    const exists = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (exists.rows.length) {
      return NextResponse.json({ ok: false, error: "该邮箱已存在，请直接修改密码或使用其他邮箱" }, { status: 409 });
    }
    const passwordHash = await hashPassword(password);
    const inviteCode = "AD" + Math.random().toString(16).slice(2, 8).toUpperCase();
    await pool.query(
      `INSERT INTO users (email, password_hash, role, invite_code) VALUES ($1, $2, 'admin', $3)`,
      [email, passwordHash, inviteCode],
    );
    return NextResponse.json({ ok: true, email });
  } catch (err) {
    console.error("[admin/settings/add-admin]", err);
    return adminError();
  }
}
