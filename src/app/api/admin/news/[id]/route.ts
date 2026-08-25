import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { adminError, requireAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";

/**
 * PATCH /api/admin/news/[id]：置顶 / 隐藏（软删）。
 * DELETE /api/admin/news/[id]：物理删除违规新闻。
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof body.pinned === "boolean") {
    values.push(body.pinned);
    sets.push(`pinned = $${values.length}`);
  }
  if (body.status === "visible" || body.status === "hidden") {
    values.push(body.status);
    sets.push(`status = $${values.length}`);
  }
  if (!sets.length) {
    return NextResponse.json({ ok: false, error: "no fields" }, { status: 400 });
  }

  try {
    values.push(Number(id));
    const { rows } = await pool.query(
      `UPDATE hotnews SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING id, status, pinned`,
      values,
    );
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "news not found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      news: { id: Number(rows[0].id), status: rows[0].status, pinned: !!rows[0].pinned },
    });
  } catch (err) {
    console.error("[admin/news]", err);
    return adminError();
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  try {
    await pool.query(`DELETE FROM hotnews WHERE id = $1`, [Number(id)]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/news]", err);
    return adminError();
  }
}
