import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { adminError, requireAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";

/**
 * GET /api/admin/reports — Phase 8 内容审核队列（admin 专属）。
 * Query：status=pending|resolved|dismissed（默认 pending；all 全部）、page、pageSize
 * 响应：{ ok, reports, total, page, pageSize }
 *  - 每条附举报人 email（LEFT JOIN users）；
 *  - pending 优先按时间正序（先报先审），其余按时间倒序。
 */
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "pending";
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));

    const where =
      status === "all"
        ? ""
        : `WHERE r.status = $1`;
    const params: unknown[] = status === "all" ? [] : [status];

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "content_reports" r ${where}`,
      params,
    );
    const { rows } = await pool.query(
      `SELECT r.id, r.target_type AS "targetType", r.target_id AS "targetId",
              r.reason, r.detail, r.status,
              r.created_at AS "createdAt", r.resolved_at AS "resolvedAt",
              u.email AS "reporterEmail"
         FROM "content_reports" r
         LEFT JOIN "users" u ON u.id = r.reporter_id
         ${where}
        ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
                 CASE WHEN r.status = 'pending' THEN r.created_at END ASC,
                 CASE WHEN r.status <> 'pending' THEN r.created_at END DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params,
    );
    return NextResponse.json({
      ok: true,
      reports: rows,
      total: countRows[0]?.n ?? 0,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("[admin/reports] query failed:", err);
    return adminError("reports query failed");
  }
}
