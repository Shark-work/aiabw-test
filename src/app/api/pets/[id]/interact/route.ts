import { NextResponse } from "next/server";

import { ensureDbSchemaOnce, pool } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import {
  applyGrowthExp,
  SOUL_CARD_INTERACT_EXP,
} from "@/lib/soul-card-config";
import {
  findSoulCardByPetId,
  updateSoulCardGrowth,
} from "@/server/repositories/soul-card-repository";

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

    // —— 灵魂卡成长挂点：每日首次互动 +SOUL_CARD_INTERACT_EXP 经验 ——
    // 判定：soul_cards.updated_at（仅在成长写回/销毁时刷新）的 UTC 日期 < 今天 →
    // mint 当天不重复给经验、每天最多一次，天然防刷；成长失败不影响互动本身。
    let growth: {
      level: number;
      exp: number;
      stage: string;
      leveledUp: boolean;
      expAwarded: number;
    } | null = null;
    try {
      await ensureDbSchemaOnce();
      const card = await findSoulCardByPetId(id);
      if (card && card.status === "active") {
        const lastGrowthDay = card.updatedAt.toISOString().slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);
        if (lastGrowthDay < today) {
          const next = applyGrowthExp(
            card.growthLevel,
            card.growthExp,
            SOUL_CARD_INTERACT_EXP,
          );
          await updateSoulCardGrowth(card.id, {
            growthLevel: next.level,
            growthExp: next.exp,
            growthStage: next.stage,
          });
          growth = { ...next, expAwarded: SOUL_CARD_INTERACT_EXP };
        } else {
          growth = {
            level: card.growthLevel,
            exp: card.growthExp,
            stage: card.growthStage,
            leveledUp: false,
            expAwarded: 0,
          };
        }
      }
    } catch (err) {
      console.error("[pets/interact] soul card growth failed:", err);
    }

    return NextResponse.json({
      ok: true,
      lastInteractionTime: rows[0].last_interaction_time,
      growth,
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
