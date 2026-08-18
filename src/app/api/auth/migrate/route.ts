import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { adoptions, threads } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * POST /api/auth/migrate
 * 请求头：Authorization: Bearer <token>
 * 请求体：{ anonymousId: string }
 *
 * 游客数据迁移：把「本设备（anonymousId）名下 user_id='anonymous'」的领养记录和线程
 * 归属更新为当前登录用户。前端应在登录/注册成功后立即调用本接口。
 * 返回 { ok, migrated: { adoptions, threads } }。
 */
export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "notSignedIn") }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const anonymousId =
      typeof body?.anonymousId === "string" ? body.anonymousId.trim() : "";

    if (!anonymousId) {
      return NextResponse.json({ ok: true, migrated: { adoptions: 0, threads: 0 } });
    }

    await ensureDbSchemaOnce();

    const adoptionResult = await db
      .update(adoptions)
      .set({ userId: user.id })
      .where(
        and(eq(adoptions.userId, "anonymous"), eq(adoptions.anonymousId, anonymousId)),
      );

    const threadResult = await db
      .update(threads)
      .set({ userId: user.id })
      .where(
        and(eq(threads.userId, "anonymous"), eq(threads.anonymousId, anonymousId)),
      );

    return NextResponse.json({
      ok: true,
      migrated: {
        adoptions: adoptionResult.rowCount ?? 0,
        threads: threadResult.rowCount ?? 0,
      },
    });
  } catch (err) {
    console.error("[auth/migrate] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "migrateFailed") }, { status: 500 });
  }
}
