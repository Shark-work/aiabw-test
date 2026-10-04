import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/soul-cards/[id]/story — 灵魂卡「成长故事」卡面数据（P1 故事外显）
 *
 * 隐私口径：仅卡主本人可读（未登录 401；非本人 404，与不存在同口径防探测）。
 * 卡本体是公开凭证，但成长数据（探索履历/幸福度）属于用户行为数据，不外露。
 *
 * 数据聚合：
 *  - 探索次数/明信片/礼物/知识/奇遇：exploration_records 按卡主用户维度
 *    （V2 探索为灵宠陪伴下的共同经历，exploration_records.pet_id 未启用，
 *     统一用户口径与成就系统一致）；
 *  - 幸福度/灵宠等级/聊天数：该卡灵宠对应的 adoptions（经 user_collectibles 关联）；
 *  - mintedAt：唤醒日（首次里程碑展示用）。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const locale = resolveLocale(req);
  const { id } = await params;
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }
  if (!id) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "soulCardNotFound") },
      { status: 404 },
    );
  }

  try {
    await ensureDbSchemaOnce();
    const { rows: cards } = await pool.query(
      `SELECT id, pet_id AS "petId", owner_id AS "ownerId",
              growth_level AS "growthLevel", minted_at AS "mintedAt"
         FROM soul_cards
        WHERE id = $1
        LIMIT 1`,
      [id],
    );
    const card = cards[0];
    if (!card || card.ownerId !== user.id) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "soulCardNotFound") },
        { status: 404 },
      );
    }

    const [explore, adoption] = await Promise.all([
      pool.query(
        `SELECT
           count(*)::int AS "explorationCount",
           count(*) FILTER (WHERE result_type = 'postcard')::int AS "postcardCount",
           count(*) FILTER (WHERE result_type = 'gift')::int AS "giftCount",
           count(*) FILTER (WHERE result_type = 'knowledge')::int AS "knowledgeCount",
           count(*) FILTER (WHERE is_rare)::int AS "rareCount",
           max(created_at) AS "lastExploredAt"
          FROM exploration_records
         WHERE user_id = $1`,
        [user.id],
      ),
      pool.query(
        `SELECT a.happiness, a.level AS "petLevel", a.chat_count AS "chatCount",
                a.pet_name AS "petName"
           FROM user_collectibles uc
           JOIN adoptions a ON a.id = uc.adoption_id
          WHERE uc.source_pet_id = $1 AND uc.owner_id = $2
          LIMIT 1`,
        [card.petId, user.id],
      ),
    ]);

    const e = explore.rows[0] ?? {};
    const a = adoption.rows[0] ?? null;
    return NextResponse.json({
      ok: true,
      story: {
        mintedAt: card.mintedAt,
        explorationCount: Number(e.explorationCount ?? 0),
        postcardCount: Number(e.postcardCount ?? 0),
        giftCount: Number(e.giftCount ?? 0),
        knowledgeCount: Number(e.knowledgeCount ?? 0),
        rareCount: Number(e.rareCount ?? 0),
        lastExploredAt: e.lastExploredAt ?? null,
        happiness: a ? Number(a.happiness) : null,
        petLevel: a ? Number(a.petLevel) : null,
        chatCount: a ? Number(a.chatCount) : null,
        petName: a ? String(a.petName) : null,
      },
    });
  } catch (err) {
    console.error("[/api/soul-cards/[id]/story] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "soulCardLoadFailed") },
      { status: 500 },
    );
  }
}
