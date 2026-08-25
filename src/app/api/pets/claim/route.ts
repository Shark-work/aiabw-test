import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import {
  evaluatePetLimit,
  buildPetLimitBody,
  FREE_PET_LIMIT,
} from "@/lib/pet-limit";
import { renderPetDescription } from "@/lib/pet-dictionary";
import { SPECIES_PET_TYPE_PREFIX } from "@/lib/species-prompt";

export const runtime = "nodejs";

/**
 * POST /api/pets/claim   — 图鉴领养（核心领养功能）
 * 请求头：Authorization: Bearer <token>（必须登录）
 * 请求体：{ petId }
 *
 * 从宠物图鉴（catalog 展示的预计算宠物实例）按 petId 认领：
 *  - 事务内 FOR UPDATE 锁定 pets 实例，保证「同一只宠物只能被领养一次」；
 *  - 单宠限制与 /api/adopt 一致：未解锁用户最多 1 只（402 引导支付），
 *    已解锁（users.is_unlocked）用户无限领养；
 *  - 认领后：pets.owner_id 落库 + 创建 adoptions 领养记录（petType=species:<id>）
 *    与独立对话线程（AI 通过 /api/chat 扮演该物种）。
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "signInFirst") },
        { status: 401 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const petId = typeof body?.petId === "string" ? body.petId.trim() : "";
    if (!petId) {
      return NextResponse.json({ ok: false, error: "petId is required" }, { status: 400 });
    }

    await ensureDbSchemaOnce();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1) 锁定目标宠物实例（含字典信息）；未领养 = owner_id IS NULL
      const { rows: petRows } = await client.query(
        `SELECT p.id, p.species_id, p.image_url, p.traits, p.visible, p.owner_id,
                d.name_zh AS "nameZh", d.name_en AS "nameEn", d.category, d.habitat,
                d.default_description_zh AS "defaultDescriptionZh",
                d.default_description_en AS "defaultDescriptionEn"
           FROM pets p
           JOIN pet_dictionary d ON d.id = p.species_id
          WHERE p.id = $1
          FOR UPDATE`,
        [petId],
      );
      const pet = petRows[0];
      if (!pet || pet.owner_id != null) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { ok: false, error: apiError(locale, "petUnavailable") },
          { status: 410 },
        );
      }
      if (pet.visible === false) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { ok: false, error: apiError(locale, "petUnavailable") },
          { status: 410 },
        );
      }

      // 2) 单宠限制：锁用户行 + 计数（与 /api/adopt 同一套规则）
      const me = await client.query(
        `SELECT is_unlocked FROM users WHERE id = $1 FOR UPDATE`,
        [user.id],
      );
      const isUnlocked = !!me.rows[0]?.is_unlocked;
      const cnt = await client.query(
        `SELECT count(*)::int AS n FROM adoptions WHERE user_id = $1`,
        [user.id],
      );
      const decision = evaluatePetLimit({
        petCount: cnt.rows[0]?.n ?? 0,
        isUnlocked,
        limit: FREE_PET_LIMIT,
      });
      if (!decision.allowed) {
        const ex = await client.query(
          `SELECT id FROM adoptions WHERE user_id = $1 ORDER BY adopted_at DESC LIMIT 1`,
          [user.id],
        );
        await client.query("ROLLBACK");
        return NextResponse.json(
          buildPetLimitBody(decision, ex.rows[0]?.id ?? null, locale),
          { status: 402 },
        );
      }

      // 3) 认领宠物实例
      await client.query(
        `UPDATE pets SET owner_id = $1, adopted_at = now(), last_interaction_time = now()
          WHERE id = $2`,
        [user.id, petId],
      );

      // 4) 创建对话线程 + 领养记录（petType=species:<speciesId>）
      const petType = `${SPECIES_PET_TYPE_PREFIX}${pet.species_id}`;
      const petName = pet.nameZh;
      const thr = await client.query(
        `INSERT INTO threads (user_id, title) VALUES ($1, $2) RETURNING id`,
        [user.id, `${petName}'s Home`],
      );
      const threadId = thr.rows[0].id;
      const ad = await client.query(
        `INSERT INTO adoptions (user_id, thread_id, pet_name, pet_type)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [user.id, threadId, petName, petType],
      );
      const welcome =
        locale === "en"
          ? `Hi! I'm ${pet.nameEn} - I just moved into AIABW. Nice to meet you!`
          : `嗨！我是${pet.nameZh}，刚刚搬进艾比世界和你做伙伴，请多关照~`;
      await client.query(
        `INSERT INTO messages (thread_id, role, parts)
         VALUES ($1, 'assistant', $2::jsonb)`,
        [threadId, JSON.stringify([{ type: "text", text: welcome }])],
      );

      await client.query("COMMIT");

      return NextResponse.json({
        ok: true,
        adoption: { id: ad.rows[0].id, petType, petName },
        threadId,
        pet: {
          id: pet.id,
          speciesId: pet.species_id,
          speciesName: locale === "en" ? pet.nameEn : pet.nameZh,
          imageUrl: pet.image_url,
          traits: pet.traits ?? {},
          defaultDescription: renderPetDescription(
            {
              defaultDescriptionZh: pet.defaultDescriptionZh,
              defaultDescriptionEn: pet.defaultDescriptionEn,
            },
            pet.traits,
            locale,
          ),
        },
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[pets/claim] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "claimFailed") },
      { status: 500 },
    );
  }
}
