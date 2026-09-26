import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { users } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { redactSensitive, validateUsername } from "@/lib/privacy";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/user/profile（Bearer 鉴权）
 * 返回当前用户的公开资料 + 隐私设置：{ id, username, showInLeaderboard }。
 * 隐私约定：不返回邮箱、登录 IP、设备等任何敏感字段（邮箱仅后端用途）。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: apiError(locale, "sessionExpired") }, { status: 401 });
  }
  try {
    await ensureDbSchemaOnce();
    const [row] = await db
      .select({ username: users.username, showInLeaderboard: users.showInLeaderboard })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        username: row?.username ?? "",
        showInLeaderboard: row?.showInLeaderboard ?? true,
      },
    });
  } catch (err) {
    console.error("[user/profile] GET failed:", redactSensitive(err instanceof Error ? err.message : String(err)));
    return NextResponse.json({ ok: false, error: apiError(locale, "profileFailed") }, { status: 500 });
  }
}

/**
 * PATCH /api/user/profile（Bearer 鉴权）
 * 请求体：{ username?, showInLeaderboard? }
 *  - username：修改公开昵称（唯一；2-24 位中英文/数字/下划线/连字符；不允许邮箱格式与系统保留名）
 *  - showInLeaderboard：隐私开关，是否参与排行榜（默认 true；false = opt-out，各榜单不再展示）
 */
export async function PATCH(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: apiError(locale, "sessionExpired") }, { status: 401 });
  }
  try {
    await ensureDbSchemaOnce();
    const body = await req.json().catch(() => ({}));

    const updates: { username?: string; showInLeaderboard?: boolean } = {};
    if (body && Object.prototype.hasOwnProperty.call(body, "username")) {
      const nameCheck = validateUsername(body.username);
      if (!nameCheck.ok) {
        const key = nameCheck.reason === "required" ? "usernameRequired" : "usernameInvalid";
        return NextResponse.json({ ok: false, error: apiError(locale, key) }, { status: 400 });
      }
      updates.username = (body.username as string).trim();
    }
    if (body && Object.prototype.hasOwnProperty.call(body, "showInLeaderboard")) {
      if (typeof body.showInLeaderboard !== "boolean") {
        return NextResponse.json({ ok: false, error: apiError(locale, "invalidPrivacySetting") }, { status: 400 });
      }
      updates.showInLeaderboard = body.showInLeaderboard;
    }
    if (updates.username === undefined && updates.showInLeaderboard === undefined) {
      return NextResponse.json({ ok: false, error: apiError(locale, "profileNothingToUpdate") }, { status: 400 });
    }

    let row: { username: string | null; showInLeaderboard: boolean | null } | undefined;
    try {
      [row] = await db
        .update(users)
        .set(updates)
        .where(eq(users.id, user.id))
        .returning({ username: users.username, showInLeaderboard: users.showInLeaderboard });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/users_username_key/i.test(msg)) {
        return NextResponse.json({ ok: false, error: apiError(locale, "usernameTaken") }, { status: 409 });
      }
      throw err;
    }

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        username: row?.username ?? updates.username ?? "",
        showInLeaderboard: row?.showInLeaderboard ?? updates.showInLeaderboard ?? true,
      },
    });
  } catch (err) {
    console.error("[user/profile] PATCH failed:", redactSensitive(err instanceof Error ? err.message : String(err)));
    return NextResponse.json({ ok: false, error: apiError(locale, "profileFailed") }, { status: 500 });
  }
}
