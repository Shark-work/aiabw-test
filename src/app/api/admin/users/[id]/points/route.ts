import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { adminError, requireAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";

/**
 * POST /api/admin/users/[id]/points  { delta: number, reason?: string }
 * 手动增加 / 扣除积分（delta 可为负），写入 points_log。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const delta = Math.trunc(Number(body.delta));
  if (!Number.isFinite(delta) || delta === 0) {
    return NextResponse.json({ ok: false, error: "delta must be a non-zero integer" }, { status: 400 });
  }
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 200) : "admin";

  try {
    const { rows } = await pool.query(
      `UPDATE users SET points = GREATEST(0, points + $1) WHERE id = $2::uuid RETURNING points, id`,
      [delta, id],
    );
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "user not found" }, { status: 404 });
    }
    await pool.query(
      `INSERT INTO points_log (user_id, amount, reason)
       VALUES ($1::uuid, $2, $3)`,
      [id, delta, reason],
    );
    return NextResponse.json({ ok: true, points: Number(rows[0].points) });
  } catch (err) {
    console.error("[admin/users/points]", err);
    return adminError();
  }
}
