import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { ensureDbSchemaOnce, pool } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** 举报对象类型（与 schema.ts contentReports.targetType 注释同步）。 */
const TARGET_TYPES = new Set(["chat", "pet_name", "ugc_pet", "postcard", "news"]);
/** 举报原因枚举。 */
const REASONS = new Set(["spam", "nsfw", "abuse", "illegal", "other"]);

/**
 * POST /api/reports — 用户举报（Phase 8 · 计划 9.3 举报机制）。
 * 请求体：{ targetType, targetId, reason, detail? }
 * 响应：{ ok, id, alreadyReported }
 *  - 幂等：uq_content_reports_target(reporter_id, target_type, target_id) 唯一索引 +
 *    ON CONFLICT DO NOTHING——同一用户对同一目标重复举报静默成功（alreadyReported=true），
 *    不产生重复工单；
 *  - 限流：10 次/小时/用户（RATE_LIMITS.reports），防举报轰炸刷管理后台；
 *  - 落库即 pending，由 /admin/moderation 队列人工处置（resolved/dismissed）。
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }

  const rl = checkRateLimit(`reports:${user.id}`, RATE_LIMITS.reports);
  if (rl.limited) return rateLimitResponse(req, rl.retryAfterSec);

  const body = await req.json().catch(() => ({}));
  const targetType = typeof body?.targetType === "string" ? body.targetType.trim() : "";
  const targetId = typeof body?.targetId === "string" ? body.targetId.trim().slice(0, 128) : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const detail =
    typeof body?.detail === "string" && body.detail.trim()
      ? body.detail.trim().slice(0, 500)
      : null;
  if (!TARGET_TYPES.has(targetType) || !targetId || !REASONS.has(reason)) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "invalidReport") },
      { status: 400 },
    );
  }

  try {
    await ensureDbSchemaOnce();
    const id = randomUUID();
    const { rowCount } = await pool.query(
      `INSERT INTO "content_reports" (id, reporter_id, target_type, target_id, reason, detail)
       VALUES ($1, $2::uuid, $3, $4, $5, $6)
       ON CONFLICT ("reporter_id", "target_type", "target_id") DO NOTHING`,
      [id, user.id, targetType, targetId, reason, detail],
    );
    return NextResponse.json({ ok: true, id, alreadyReported: (rowCount ?? 0) === 0 });
  } catch (err) {
    console.error("[reports] insert failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "reportFailed") },
      { status: 500 },
    );
  }
}
