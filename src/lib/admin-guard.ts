import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

/**
 * 服务端 Admin 守卫：校验登录态 + role === 'admin'。
 * 用于所有 /api/admin/* 接口（防直接调 API 绕过前端拦截）。
 * 返回：{ user }（管理员）或 NextResponse（401/403）。
 */
export async function requireAdmin(
  req: Request,
): Promise<{ user: { id: string; email: string } } | NextResponse> {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(resolveLocale(req), "signInFirst") },
      { status: 401 },
    );
  }
  const { rows } = await pool.query(`SELECT role FROM users WHERE id = $1::uuid LIMIT 1`, [user.id]);
  if (rows[0]?.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "forbidden: admin only" },
      { status: 403 },
    );
  }
  return { user: { id: user.id, email: user.email } };
}

/** 统一 500 响应。 */
export function adminError(message = "internal error"): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}
