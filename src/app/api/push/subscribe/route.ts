import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { isPushConfigured } from "@/lib/web-push";

export const runtime = "nodejs";

/**
 * POST /api/push/subscribe — 保存/刷新浏览器推送订阅（P2 召回）。
 * 请求体：{ subscription: { endpoint, keys: { p256dh, auth } }, anonymousId? }
 *  - 登录用户 → 绑定 user_id；游客 → 绑定 anonymous_id
 *    （登录后携带 token 再次调用即可把游客订阅转绑到账号）；
 *  - endpoint 全局唯一，重复订阅 UPSERT（更新密钥、语言与归属）。
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  try {
    if (!isPushConfigured()) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "pushNotConfigured") },
        { status: 503 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const sub = body?.subscription;
    const endpoint =
      typeof sub?.endpoint === "string" ? sub.endpoint.trim() : "";
    const p256dh =
      sub?.keys && typeof sub.keys.p256dh === "string"
        ? sub.keys.p256dh.trim()
        : "";
    const auth =
      sub?.keys && typeof sub.keys.auth === "string"
        ? sub.keys.auth.trim()
        : "";
    const anonymousId =
      typeof body?.anonymousId === "string" ? body.anonymousId.trim() : "";

    if (!endpoint.startsWith("https://") || !p256dh || !auth) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "pushSubscribeFailed") },
        { status: 400 },
      );
    }

    const user = await getUserFromRequest(req);

    await ensureDbSchemaOnce();

    await pool.query(
      `INSERT INTO push_subscriptions
         (endpoint, p256dh, auth, user_id, anonymous_id, locale, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (endpoint) DO UPDATE SET
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_id = COALESCE(EXCLUDED.user_id, push_subscriptions.user_id),
         anonymous_id = COALESCE(EXCLUDED.anonymous_id, push_subscriptions.anonymous_id),
         locale = EXCLUDED.locale,
         last_seen_at = now()`,
      [
        endpoint,
        p256dh,
        auth,
        user ? user.id : null,
        user ? null : anonymousId || null,
        locale,
      ],
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/subscribe] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "pushSubscribeFailed") },
      { status: 500 },
    );
  }
}