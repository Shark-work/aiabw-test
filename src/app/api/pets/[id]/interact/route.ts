import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * POST /api/pets/[id]/interact
 * 用户与宠物互动（喂食/抚摸）→ 刷新 last_interaction_time = now()。
 * 损失厌恶机制：互动后灰暗滤镜立即消失、恢复活泼状态。
 * 仅宠物主人可操作（ownership 校验）。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const locale = resolveLocale(req);
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "missing pet id" }, { status: 400 });
    }

    const { rows } = await pool.query(
      `UPDATE pets
          SET last_interaction_time = now()
        WHERE id = $1 AND owner_id = $2
        RETURNING last_interaction_time`,
      [id, user.id],
    );
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: apiError(locale, "noPermissionPet") }, { status: 403 });
    }

    return NextResponse.json({
      ok: true,
      lastInteractionTime: rows[0].last_interaction_time,
      message: locale === "en" ? "You fed & cuddled your pet ❤️" : "你喂饱并抱了抱它 ❤️",
    });
  } catch (err) {
    console.error("[pets/interact] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(resolveLocale(req), "interactFailed") },
      { status: 500 },
    );
  }
}
