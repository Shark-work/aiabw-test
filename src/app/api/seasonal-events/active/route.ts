import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import { getActiveSeasonalEvent, getSeasonalProgress } from "@/server/queries/seasonal-queries";

export const runtime = "nodejs";

/**
 * GET /api/seasonal-events/active — 当前进行中的季节活动（P2 社交传播 · 改动三）
 *
 * 匿名可读：活动定义公开（名称/描述/时间窗/奖励预览）；
 * 登录时附带本人进度（explorationCount / bondCrystals / claimed）。
 * 无进行中活动 → { ok: true, event: null, progress: null }（前端 banner 不渲染）。
 * 骨架：占位活动 is_active=false 永不命中；活动结束后进度行保留可查但不再产出奖励。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  try {
    await ensureDbSchemaOnce();
    const event = await getActiveSeasonalEvent();
    let progress = null;
    if (event) {
      const user = await getUserFromRequest(req);
      if (user) progress = await getSeasonalProgress(user.id, event.slug);
    }
    return NextResponse.json({ ok: true, event, progress });
  } catch (err) {
    console.error("[/api/seasonal-events/active] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "seasonalEventFailed") },
      { status: 500 },
    );
  }
}
