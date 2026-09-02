import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * POST /api/push/unsubscribe — 删除推送订阅（用户关闭提醒 / 浏览器退订）。
 * 请求体：{ endpoint }
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  try {
    const body = await req.json().catch(() => ({}));
    const endpoint =
      typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
    if (!endpoint.startsWith("https://")) {
      return NextResponse.json(
        { ok: false, error: "endpoint is required" },
        { status: 400 },
      );
    }
    await ensureDbSchemaOnce();
    await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [
      endpoint,
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/unsubscribe] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "pushSubscribeFailed") },
      { status: 500 },
    );
  }
}