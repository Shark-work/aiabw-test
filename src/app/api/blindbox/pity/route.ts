import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import { PITY_THRESHOLD, PITY_RESET_RARITIES, pickPityRarity } from "@/lib/pity";
import { redactSensitive } from "@/lib/privacy";

export const runtime = "nodejs";

/**
 * GET /api/blindbox/pity?poolId=<id> — 保底进度查询（Phase 6 · 前端进度条数据源）
 *  - 鉴权（401）；poolId 必填（400）；
 *  - 返回 { pullCount, threshold, remaining, resetRarities, guaranteedRarity }：
 *    guaranteedRarity = 该池保底触发时必出的稀有度（池内 ≥epic 最高档，无 epic+ 则池内最高档），
 *    前端「再抽 X 次必出 Y」文案与进度条均以此为准，与服务端判定同源（src/lib/pity.ts）。
 *  - 未抽过（pity_counter 无行）→ pullCount=0。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  try {
    await ensureDbSchemaOnce();
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }
    const poolId = new URL(req.url).searchParams.get("poolId")?.trim() ?? "";
    if (!poolId) {
      return NextResponse.json({ ok: false, error: apiError(locale, "invalidBlindboxPool") }, { status: 400 });
    }

    const { rows: poolRows } = await pool.query(
      `SELECT probabilities FROM blindbox_pools WHERE id = $1 AND is_active = true LIMIT 1`,
      [poolId],
    );
    if (poolRows.length === 0) {
      return NextResponse.json({ ok: false, error: apiError(locale, "blindboxUnavailable") }, { status: 404 });
    }
    const probabilities = (poolRows[0].probabilities ?? {}) as Record<string, number>;

    const { rows } = await pool.query(
      `SELECT pull_count AS "pullCount" FROM pity_counter
        WHERE user_id = $1::uuid AND pool_id = $2 LIMIT 1`,
      [user.id, poolId],
    );
    const pullCount = Number(rows[0]?.pullCount ?? 0);

    return NextResponse.json({
      ok: true,
      poolId,
      pullCount,
      threshold: PITY_THRESHOLD,
      remaining: Math.max(0, PITY_THRESHOLD - pullCount),
      resetRarities: PITY_RESET_RARITIES,
      guaranteedRarity: pickPityRarity(probabilities),
    });
  } catch (err) {
    console.error("[blindbox/pity] failed:", redactSensitive(err instanceof Error ? err.message : String(err)));
    return NextResponse.json({ ok: false, error: apiError(locale, "blindboxFailed") }, { status: 500 });
  }
}
