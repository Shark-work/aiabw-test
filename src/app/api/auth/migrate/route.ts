import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce, pool } from "@/db/client";
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

    // P1 零摩擦领养：游客设备占位的宠物实例归并到账号（guest_owner → owner_id），
    // 与上面的 adoptions/threads 迁移配套（图鉴认领时已同时创建匿名领养记录）。
    const petResult = await pool.query(
      `UPDATE pets
          SET owner_id = $1::uuid,
              guest_owner = NULL,
              adopted_at = COALESCE(adopted_at, now()),
              last_interaction_time = COALESCE(last_interaction_time, now())
        WHERE guest_owner = $2 AND owner_id IS NULL`,
      [user.id, anonymousId],
    );

    return NextResponse.json({
      ok: true,
      migrated: {
        adoptions: adoptionResult.rowCount ?? 0,
        threads: threadResult.rowCount ?? 0,
        pets: petResult.rowCount ?? 0,
      },
    });
  } catch (err) {
    console.error("[auth/migrate] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "migrateFailed") }, { status: 500 });
  }
}
