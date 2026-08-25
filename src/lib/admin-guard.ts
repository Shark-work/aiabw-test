import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

/** 后台会话时效：超过 24 小时未登录，要求重新登录（防会话残留）。 */
const ADMIN_SESSION_TTL_HOURS = 24;

/**
 * 服务端 Admin 守卫：校验登录态 + role === 'admin' + 会话时效。
 * 用于所有 /api/admin/* 接口（防直接调 API 绕过前端拦截）。
 * 返回：{ user }（管理员）或 NextResponse（401/403/reauth）。
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
  const { rows } = await pool.query(
    `SELECT role, last_login_at FROM users WHERE id = $1::uuid LIMIT 1`,
    [user.id],
  );
  if (rows[0]?.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "forbidden: admin only" },
      { status: 403 },
    );
  }
  // 会话时效：last_login_at 超过 24h → 401 reauth（要求重新登录）
  const lastLogin = rows[0]?.last_login_at;
  if (lastLogin) {
    const ageHours = (Date.now() - new Date(lastLogin).getTime()) / 3_600_000;
    if (ageHours > ADMIN_SESSION_TTL_HOURS) {
      return NextResponse.json(
        { ok: false, error: "会话已过期，请重新登录", code: "reauth" },
        { status: 401 },
      );
    }
  }
  return { user: { id: user.id, email: user.email } };
}

/** 统一 500 响应。 */
export function adminError(message = "internal error"): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

