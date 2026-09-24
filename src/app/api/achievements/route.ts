import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import { syncAchievements } from "@/lib/achievements-service";

export const runtime = "nodejs";

/**
 * GET /api/achievements（Bearer 鉴权）
 * 成就面板数据源：
 *  - 惰性评估：聚合源表统计 → 对达成且未解锁的徽章事务化解锁 + 积分入账
 *    （覆盖签到连击 / 亲密度满值 / 百科收集等非探索节点产生的进度）；
 *  - 返回 { badges, unlockedCount, totalCount, newlyUnlocked }，
 *    前端据 newlyUnlocked 弹庆祝动画（积分已到账）。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, code: "SIGN_IN_REQUIRED", error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }

  try {
    await ensureDbSchemaOnce();
    const result = await syncAchievements(user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[/api/achievements] failed:", err);
    return NextResponse.json(
      {
        ok: false,
        code: "SERVER_ERROR",
        error: apiError(locale, "achievementsFailed"),
      },
      { status: 500 },
    );
  }
}
