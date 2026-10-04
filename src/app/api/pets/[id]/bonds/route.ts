import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { bondScore, bondUnlocked } from "@/lib/bond-config";
import { BREED_COST } from "@/lib/genetics";

export const runtime = "nodejs";

/**
 * GET /api/pets/[id]/bonds — 灵宠「羁绊」候选列表（P1 故事外显 · 改动三）
 * 路径参数 id 为 **领养实例 id（adoptions.id）**（详情页上下文即领养实例）。
 *
 * 响应：{ ok, me, partners }
 *  - me：当前灵宠（collectibleId 为 /api/pets/breed 亲本输入 + 冷却状态）；
 *  - partners：同用户、同物种、其他持有中的灵宠候选（含羁绊值/是否达标/冷却）；
 *  - 羁绊值：bond-config bondScore 纯函数（共同探索 + 双向幸福 + 双向聊天，0-100）。
 *
 * 关联链：adoptions →（user_collectibles.adoption_id）→ pets（source_pet_id）；
 * 老数据无藏品关联的灵宠不出现在候选（无法作为结晶亲本，与 breed 校验一致）。
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

  try {
    await ensureDbSchemaOnce();

    // 1) 当前灵宠（归属行内校验：adoption id + user_id；无藏品关联 → 404）
    const { rows: meRows } = await pool.query(
      `SELECT p.id AS "petId", p.species_id AS "speciesId",
              uc.id AS "collectibleId", uc.breed_cooldown_until AS "cooldownUntil",
              a.pet_name AS "petName", a.happiness, a.chat_count AS "chatCount"
         FROM adoptions a
         JOIN user_collectibles uc ON uc.adoption_id = a.id
         JOIN pets p ON p.id = uc.source_pet_id
        WHERE a.id = $1 AND a.user_id = $2 AND uc.owner_id = $2 AND uc.status = 'active'
        LIMIT 1`,
      [id, user.id],
    );
    const me = meRows[0];
    if (!me) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "parentNotFound") },
        { status: 404 },
      );
    }

    // 2) 同物种候选（其他持有中灵宠）+ 3) 用户累计探索（共享经历）
    const [partners, explore] = await Promise.all([
      pool.query(
        `SELECT p.id AS "petId", p.image_url AS "imageUrl",
                uc.id AS "collectibleId", uc.breed_cooldown_until AS "cooldownUntil",
                a.pet_name AS "petName", a.happiness, a.chat_count AS "chatCount"
           FROM user_collectibles uc
           JOIN pets p ON p.id = uc.source_pet_id
           JOIN adoptions a ON a.id = uc.adoption_id
          WHERE uc.owner_id = $1 AND uc.status = 'active'
            AND p.species_id = $2 AND uc.id != $3
          ORDER BY a.happiness DESC`,
        [user.id, me.speciesId, me.collectibleId],
      ),
      pool.query(
        `SELECT count(*)::int AS n FROM exploration_records WHERE user_id = $1`,
        [user.id],
      ),
    ]);

    const sharedExplorations = Number(explore.rows[0]?.n ?? 0);
    const now = Date.now();
    const list = partners.rows.map((p) => {
      const score = bondScore({
        sharedExplorations,
        myHappiness: Number(me.happiness),
        partnerHappiness: Number(p.happiness),
        myChats: Number(me.chatCount),
        partnerChats: Number(p.chatCount),
      });
      const cooldownUntil = p.cooldownUntil ? new Date(p.cooldownUntil) : null;
      return {
        petId: String(p.petId),
        collectibleId: String(p.collectibleId),
        petName: String(p.petName),
        imageUrl: p.imageUrl ? String(p.imageUrl) : null,
        happiness: Number(p.happiness),
        bondScore: score,
        unlocked: bondUnlocked(score),
        cooldownUntil,
        inCooldown: !!cooldownUntil && cooldownUntil.getTime() > now,
      };
    });

    return NextResponse.json({
      ok: true,
      me: {
        petId: String(me.petId),
        collectibleId: String(me.collectibleId),
        petName: String(me.petName),
        happiness: Number(me.happiness),
        cooldownUntil: me.cooldownUntil ?? null,
        inCooldown: !!me.cooldownUntil && new Date(me.cooldownUntil).getTime() > now,
      },
      sharedExplorations,
      breedCost: BREED_COST,
      partners: list,
    });
  } catch (err) {
    console.error("[/api/pets/[id]/bonds] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "breedFailed") },
      { status: 500 },
    );
  }
}
