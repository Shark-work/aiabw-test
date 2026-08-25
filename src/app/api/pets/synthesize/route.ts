import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, pool } from "@/db/client";
import { pets } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { renderPetDescription, type PetTraits } from "@/lib/pet-dictionary";
import { mintCollectible } from "@/lib/nfr";
import { releaseInviteReward } from "@/lib/referral-reward";

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

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // ② 原子分配一条未领养宠物（跳过被并发占用的行）
      const { rows: assigned } = await client.query(
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
        await client.query("ROLLBACK");
        return NextResponse.json({ ok: false, error: apiError(locale, "emptyPool") }, { status: 503 });
      }
      const pet = assigned[0];

      // 附带字典物种信息 + 默认介绍（列别名转 camelCase，匹配 DictionarySpecies）
      const { rows: speciesRows } = await client.query(
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

      // —— NFR 确权：合成分配成功同步铸造数字藏品 ——
      const minted = await mintCollectible(client, {
        ownerId: user.id,
        species: {
          speciesId: pet.species_id,
          nameZh: species?.nameZh ?? pet.species_id,
          nameEn: species?.nameEn ?? pet.species_id,
          category: species?.category ?? "unknown",
          habitat: species?.habitat ?? null,
          rarity: String(traits.rarity ?? "common"),
          element: traits.element ? String(traits.element) : undefined,
          imageUrl: pet.image_url,
        },
        dna: traits,
        generation: Number(pet.generation ?? 1),
        parentHashIds: Array.isArray(pet.parent_ids)
          ? pet.parent_ids.map(String)
          : null,
        sourcePetId: pet.id,
        adoptionId: null,
      });

      await client.query("COMMIT");

      // 裂变活跃验证：被邀请人完成首次领养 → 释放冻结的邀请奖励（后台异步，失败不影响领养）
      void releaseInviteReward(user.id).catch(() => {});

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
        nfr: {
          id: minted.id,
          hashId: minted.hashId,
          collectibleId: minted.collectibleId,
          generation: Number(pet.generation ?? 1),
          lockedUntil: minted.lockedUntil,
        },
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[pets/synthesize] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(resolveLocale(req), "adoptFailed") },
      { status: 500 },
    );
  }
}
