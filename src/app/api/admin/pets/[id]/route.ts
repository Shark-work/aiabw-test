import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { adminError, requireAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";

/**
 * PATCH /api/admin/pets/[id]
 * 编辑宠物：custom_description（描述）、image_url（图片 URL）、visible（上架/下架）。
 * 下架后普通用户图鉴不可见（catalog 过滤 visible=true）。
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof body.customDescription === "string") {
    values.push(body.customDescription.slice(0, 500));
    sets.push(`custom_description = $${values.length}`);
  }
  if (typeof body.imageUrl === "string" && body.imageUrl.trim()) {
    values.push(body.imageUrl.trim().slice(0, 500));
    sets.push(`image_url = $${values.length}`);
  }
  if (typeof body.visible === "boolean") {
    values.push(body.visible);
    sets.push(`visible = $${values.length}`);
  }
  if (!sets.length) {
    return NextResponse.json({ ok: false, error: "no fields to update" }, { status: 400 });
  }

  try {
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE pets SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING id, visible`,
      values,
    );
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "pet not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, pet: { id, visible: !!rows[0].visible } });
  } catch (err) {
    console.error("[admin/pets]", err);
    return adminError();
  }
}
