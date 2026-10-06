import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { adminError, requireAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";

/**
 * PATCH /api/admin/reports/[id] — 处置举报（admin 专属）。
 * 请求体：{ action: "resolve" | "dismiss" }
 *  - resolve  = 确认违规（status→resolved）；
 *  - dismiss  = 驳回举报（status→dismissed）；
 *  - 审计：写 resolved_at + resolved_by（操作管理员）；
 *  - 仅 pending 可处置（重复处置返回 ok:false 409，防并发双击产生歧义态）。
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action : "";
  const status = action === "resolve" ? "resolved" : action === "dismiss" ? "dismissed" : null;
  if (!status) {
    return NextResponse.json(
      { ok: false, error: "action must be resolve or dismiss" },
      { status: 400 },
    );
  }

  try {
    const { rowCount } = await pool.query(
      `UPDATE "content_reports"
          SET status = $1, resolved_at = now(), resolved_by = $2::uuid
        WHERE id = $3 AND status = 'pending'`,
      [status, guard.user.id, id],
    );
    if ((rowCount ?? 0) === 0) {
      return NextResponse.json(
        { ok: false, error: "report not found or already resolved" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, id, status });
  } catch (err) {
    console.error("[admin/reports] patch failed:", err);
    return adminError("report patch failed");
  }
}
