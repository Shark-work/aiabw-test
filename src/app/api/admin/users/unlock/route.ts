import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { adminError, requireAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";

/**
 * POST /api/admin/users/unlock { userId }
 * 解锁被锁定的账号（清 locked_until）。
 */
export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => ({}));
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!userId) {
    return NextResponse.json({ ok: false, error: "userId required" }, { status: 400 });
  }

  try {
    const r = await pool.query(
      `UPDATE users SET locked_until = NULL WHERE id = $1::uuid RETURNING email`,
      [userId],
    );
    if (!r.rows.length) {
      return NextResponse.json({ ok: false, error: "user not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, email: r.rows[0].email });
  } catch (err) {
    console.error("[admin/users/unlock]", err);
    return adminError();
  }
}
