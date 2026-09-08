import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { adoptions } from "@/db/schema";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getMapInfo } from "@/lib/exploration-config";

export const runtime = "nodejs";

/**
 * GET /api/exploration/status?adoptionId=<uuid>
 * 返回该艾比的探索状态：累计步数、当前地图 id、当前地图进度、当前天气。
 * 公开接口（无需登录）：exploration 状态是与领养记录绑定的，不是与用户账号绑定的；
 * 同一 adoptionId 下游客/登录态可复用同一份进度。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const adoptionId = url.searchParams.get("adoptionId");
  if (!adoptionId) {
    return NextResponse.json(
      { ok: false, error: apiError(resolveLocale(req), "missingAdoptionId") },
      { status: 400 },
    );
  }

  try {
    await ensureDbSchemaOnce();

    const [row] = await db
      .select({
        id: adoptions.id,
        userId: adoptions.userId,
        explorationSteps: adoptions.explorationSteps,
        currentMapId: adoptions.currentMapId,
        mapProgress: adoptions.mapProgress,
        weather: adoptions.weather,
      })
      .from(adoptions)
      .where(eq(adoptions.id, adoptionId))
      .limit(1);

    if (!row) {
      return NextResponse.json(
        { ok: false, error: apiError(resolveLocale(req), "adoptionNotFound") },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      adoptionId: row.id,
      explorationSteps: row.explorationSteps ?? 0,
      currentMapId: row.currentMapId ?? 1,
      mapProgress: row.mapProgress ?? 0,
      weather: row.weather ?? "sunny",
      // 顺便返回地图展示元信息（避免前端再去查 7 段常量）
      map: getMapInfo(row.currentMapId ?? 1),
    });
  } catch (err) {
    console.error("[/api/exploration/status] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(resolveLocale(req), "petStatusFailed") },
      { status: 500 },
    );
  }
}
