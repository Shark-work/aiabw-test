import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { adminError, requireAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";

/**
 * GET /api/admin/news?page=1&pageSize=20&status=
 * 内容/新闻管理：查看自动抓取的新闻列表（支持按状态筛选）。
 */
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20) || 20));
  const status = url.searchParams.get("status") ?? "";

  const params: unknown[] = [];
  let whereSql = "";
  if (status === "visible" || status === "hidden") {
    params.push(status);
    whereSql = `WHERE status = $1`;
  }

  try {
    const [{ rows: list }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT id, source, title, desc, cover, hot, timestamp, url, status, pinned
           FROM hotnews ${whereSql}
          ORDER BY pinned DESC, hot DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, (page - 1) * pageSize],
      ),
      pool.query(`SELECT count(*)::int AS n FROM hotnews ${whereSql}`, params),
    ]);

    return NextResponse.json({
      ok: true,
      total: countRows[0]?.n ?? 0,
      news: list.map((r) => ({
        id: Number(r.id),
        source: r.source,
        title: r.title,
        desc: r.desc,
        cover: r.cover,
        hot: Number(r.hot),
        timestamp: Number(r.timestamp),
        url: r.url,
        status: r.status,
        pinned: !!r.pinned,
      })),
    });
  } catch (err) {
    console.error("[admin/news]", err);
    return adminError();
  }
}
