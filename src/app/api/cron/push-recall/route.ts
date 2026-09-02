import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { isPushConfigured, sendWebPush } from "@/lib/web-push";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/push-recall （Vercel Cron 每日一次；北京时间 20:00）
 * 安全：若配置了 CRON_SECRET，则要求 Authorization: Bearer <CRON_SECRET>。
 *
 * P2 Web Push 召回策略：
 *  - 目标：名下宠物 ≥3 天未互动的订阅（登录用户按 user_id，游客按 anonymous_id）；
 *  - 防打扰：同一订阅 7 天内最多召回一次（last_notified_at）；
 *  - 自愈：endpoint 返回 404/410（订阅失效）时自动删除该订阅。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  }

  if (!isPushConfigured()) {
    return NextResponse.json({ ok: true, skipped: "push-not-configured" });
  }

  await ensureDbSchemaOnce();

  // 每批最多 200 条（控制在 Cron 时限内；后续批次由「7 天窗口」自然滚动）
  const { rows: subs } = await pool.query(
    `SELECT s.id, s.endpoint, s.p256dh, s.auth, s.locale
       FROM push_subscriptions s
      WHERE (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '7 days')
        AND (
          (s.user_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM adoptions a
             WHERE a.user_id = s.user_id
               AND COALESCE(a.last_interacted_at, a.adopted_at) < now() - interval '3 days'
          ))
          OR (s.user_id IS NULL AND s.anonymous_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM adoptions a
             WHERE a.user_id = 'anonymous'
               AND a.anonymous_id = s.anonymous_id
               AND COALESCE(a.last_interacted_at, a.adopted_at) < now() - interval '3 days'
          ))
        )
      ORDER BY s.last_notified_at NULLS FIRST
      LIMIT 200`,
  );

  let sent = 0;
  let gone = 0;
  let failed = 0;

  for (const s of subs) {
    const isEn = s.locale === "en";
    const payload = {
      title: isEn ? "Your pet misses you 🐾" : "你的宠物想你了 🐾",
      body: isEn
        ? "It's been 3 days since your last visit. Come say hi and keep the bond alive!"
        : "3 天没回来看它啦，回来说说话、喂喂它吧～",
      url: `/${isEn ? "en" : "zh"}/my-pets`,
      tag: "aiabw-recall",
      icon: "/icon.svg",
    };
    const result = await sendWebPush(
      { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
      payload,
      86400,
    );
    if (result === "success") {
      sent++;
      await pool.query(
        `UPDATE push_subscriptions SET last_notified_at = now() WHERE id = $1`,
        [s.id],
      );
    } else if (result === "gone") {
      gone++;
      await pool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [s.id]);
    } else {
      failed++;
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: subs.length,
    sent,
    gone,
    failed,
  });
}