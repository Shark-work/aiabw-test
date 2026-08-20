import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, pool } from "@/db/client";
import { pets } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { renderPetDescription, type PetTraits } from "@/lib/pet-dictionary";

export const runtime = "nodejs";

/**
 * POST /api/pets/synthesize
 * 高性能“领养/合成”：用户点击合成时，后端只做两件事——
 *   ① 校验登录态与用户旧宠物所有权；
 *   ② 从预计算 pets 池原子分配一条 owner_id IS NULL 的记录（FOR UPDATE SKIP LOCKED）。
 * 全程无图片处理，目标响应 < 50ms。
 */
export async function POST(req: Request) {
  try {
    const locale = resolveLocale(req);
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }

    // ① 校验用户旧宠物所有权：存在即必须是本人的（合成前提）
    const owned = await db
      .select({ id: pets.id, generation: pets.generation })
      .from(pets)
      .where(eq(pets.ownerId, user.id))
      .limit(1);

    // ② 原子分配一条未领养宠物（跳过被并发占用的行）
    const { rows: assigned } = await pool.query(
      `WITH chosen AS (
         SELECT id FROM pets
          WHERE owner_id IS NULL
          ORDER BY random()
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE pets p
          SET owner_id = $1, adopted_at = now()
         FROM chosen c
        WHERE p.id = c.id
        RETURNING p.id, p.species_id, p.image_url, p.traits, p.generation, p.parent_ids, p.custom_description, p.adopted_at`,
      [user.id],
    );
    if (!assigned.length) {
      return NextResponse.json({ ok: false, error: apiError(locale, "emptyPool") }, { status: 503 });
    }
    const pet = assigned[0];

    // 附带字典物种信息 + 默认介绍（列别名转 camelCase，匹配 DictionarySpecies）
    const { rows: speciesRows } = await pool.query(
      `SELECT id,
              name_zh AS "nameZh",
              name_en AS "nameEn",
              category,
              habitat,
              default_description_zh AS "defaultDescriptionZh",
              default_description_en AS "defaultDescriptionEn"
         FROM pet_dictionary WHERE id = $1`,
      [pet.species_id],
    );
    const species = speciesRows[0] ?? null;
    const traits = (pet.traits ?? {}) as PetTraits;

    return NextResponse.json({
      ok: true,
      pet: {
        id: pet.id,
        speciesId: pet.species_id,
        speciesName: locale === "en" ? species?.name_en : species?.name_zh,
        category: species?.category ?? null,
        imageUrl: pet.image_url,
        traits,
        generation: Number(pet.generation),
        parentIds: pet.parent_ids,
        customDescription: pet.custom_description ?? null,
        defaultDescription: species
          ? renderPetDescription(species, traits, locale)
          : null,
        adoptedAt: pet.adopted_at,
      },
      // 拥有旧宠物数（所有权校验结果）
      ownedCount: owned.length,
    });
  } catch (err) {
    console.error("[pets/synthesize] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(resolveLocale(req), "adoptFailed") },
      { status: 500 },
    );
  }
}
