import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { adminError, requireAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";

/**
 * GET /api/admin/users?page=1&pageSize=20
 * 用户管理列表：邮箱 / 注册时间 / 拥有的宠物数 / 当前积分 / 角色。
 */
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20) || 20));

  try {
    const [{ rows: list }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT u.id, u.email, u.points, u.role, u.created_at,
                (SELECT count(*)::int FROM adoptions a WHERE a.user_id = u.id::text) AS pet_count,
                (SELECT count(*)::int FROM pets p WHERE p.owner_id = u.id AND p.status='active') AS pool_pet_count
           FROM users u
          ORDER BY u.created_at DESC
          LIMIT $1 OFFSET $2`,
        [pageSize, (page - 1) * pageSize],
      ),
      pool.query(`SELECT count(*)::int AS n FROM users`),
    ]);

    return NextResponse.json({
      ok: true,
      total: countRows[0]?.n ?? 0,
      users: list.map((r) => ({
        id: r.id,
        email: r.email,
        points: Number(r.points ?? 0),
        role: r.role,
        createdAt: r.created_at,
        petCount: Number(r.pet_count ?? 0) + Number(r.pool_pet_count ?? 0),
      })),
    });
  } catch (err) {
    console.error("[admin/users]", err);
    return adminError();
  }
}
