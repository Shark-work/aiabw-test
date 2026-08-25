import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { adminError, requireAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";

/**
 * GET /api/admin/settings/admins
 * 管理员列表：邮箱 / 注册时间 / 最后登录时间。
 */
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  try {
    const { rows } = await pool.query(
      `SELECT id, email, created_at, last_login_at, locked_until,
              (locked_until IS NOT NULL AND locked_until > now()) AS locked
         FROM users WHERE role = 'admin' ORDER BY created_at`,
    );
    return NextResponse.json({
      ok: true,
      admins: rows.map((r) => ({
        id: r.id,
        email: r.email,
        createdAt: r.created_at,
        lastLoginAt: r.last_login_at,
        locked: !!r.locked,
      })),
    });
  } catch (err) {
    console.error("[admin/settings/admins]", err);
    return adminError();
  }
}
