import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { hashPassword } from "@/lib/auth";
import { adminError, requireAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";

/**
 * POST /api/admin/settings/change-password { email, newPassword }
 * 修改管理员密码（scrypt 哈希，与登录兼容）。
 */
export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!email || newPassword.length < 6) {
    return NextResponse.json({ ok: false, error: "邮箱或密码格式不正确（密码至少 6 位）" }, { status: 400 });
  }

  try {
    const user = await pool.query(`SELECT id, role FROM users WHERE email = $1`, [email]);
    if (!user.rows.length || user.rows[0].role !== "admin") {
      return NextResponse.json({ ok: false, error: "该邮箱不是管理员账号" }, { status: 404 });
    }
    const passwordHash = await hashPassword(newPassword);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, user.rows[0].id]);
    return NextResponse.json({ ok: true, email });
  } catch (err) {
    console.error("[admin/settings/change-password]", err);
    return adminError();
  }
}
