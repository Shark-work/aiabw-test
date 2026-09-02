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
import { mintCollectible } from "@/lib/nfr";
import { releaseInviteReward } from "@/lib/referral-reward";

export const runtime = "nodejs";

/**
 * POST /api/pets/claim   — 图鉴领养（核心领养功能）
 * 请求头：Authorization: Bearer <token>（可省略；游客需在请求体带 anonymousId）
 * 请求体：{ petId, anonymousId? }
 *
 * 从宠物图鉴（catalog 展示的预计算宠物实例）按 petId 认领：
 *  - 归属：登录用户 → pets.owner_id；游客 → pets.guest_owner 设备占位
 *    （P1 零摩擦领养，登录后由 /api/auth/migrate 归并到 owner_id）；
 *  - 事务内 FOR UPDATE 锁定 pets 实例，保证「同一只宠物只能被领养一次」；
 *  - 单宠限制与 /api/adopt 一致：未解锁用户最多 1 只（402：游客→引导登录，
 *    登录用户→引导支付解锁），已解锁（users.is_unlocked）用户无限领养；
 *  - 认领后：创建 adoptions 领养记录（petType=species:<id>）与独立对话线程
 *    （AI 通过 /api/chat 扮演该物种）；NFR 确权仅登录用户（游客无账号归属）。
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  try {
    // 归属：登录用户认领到账号（owner_id）；游客用 anonymousId 设备占位（guest_owner），
    // 登录后由 /api/auth/migrate 归并（P1 零摩擦领养）。
    const user = await getUserFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const petId = typeof body?.petId === "string" ? body.petId.trim() : "";
    const anonymousId =
      typeof body?.anonymousId === "string" ? body.anonymousId.trim() : "";
    if (!user && !anonymousId) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "signInFirst") },
        { status: 401 },
      );
    }
    if (!petId) {
      return NextResponse.json({ ok: false, error: "petId is required" }, { status: 400 });
    }

    await ensureDbSchemaOnce();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1) 锁定目标宠物实例（含字典信息）；未领养 = owner_id 与 guest_owner 均为空
      //    （guest_owner：游客设备占位，同一实例只能被认领一次）
      const { rows: petRows } = await client.query(
        `SELECT p.id, p.species_id, p.image_url, p.traits, p.visible, p.owner_id, p.guest_owner, p.generation,
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
      if (!pet || pet.owner_id != null || pet.guest_owner != null) {
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

      // 2) 单宠限制：锁用户行 + 计数（与 /api/adopt 同一套规则；游客按设备计数）
      let isUnlocked = false;
      if (user) {
        const me = await client.query(
          `SELECT is_unlocked FROM users WHERE id = $1 FOR UPDATE`,
          [user.id],
        );
        isUnlocked = !!me.rows[0]?.is_unlocked;
      }
      const ownerWhere = user
        ? `user_id = $1`
        : `user_id = 'anonymous' AND anonymous_id = $1`;
      const cnt = await client.query(
        `SELECT count(*)::int AS n FROM adoptions WHERE ${ownerWhere}`,
        [user ? user.id : anonymousId],
      );
      const decision = evaluatePetLimit({
        petCount: cnt.rows[0]?.n ?? 0,
        isUnlocked,
        limit: FREE_PET_LIMIT,
      });
      if (!decision.allowed) {
        const ex = await client.query(
          `SELECT id FROM adoptions WHERE ${ownerWhere} ORDER BY adopted_at DESC LIMIT 1`,
          [user ? user.id : anonymousId],
        );
        await client.query("ROLLBACK");
        return NextResponse.json(
          buildPetLimitBody(decision, ex.rows[0]?.id ?? null, locale),
          { status: 402 },
        );
      }

      // 3) 认领宠物实例（游客写 guest_owner 占位，登录归并后转为 owner_id）
      await client.query(
        user
          ? `UPDATE pets SET owner_id = $1, guest_owner = NULL, adopted_at = now(), last_interaction_time = now() WHERE id = $2`
          : `UPDATE pets SET guest_owner = $1, adopted_at = now(), last_interaction_time = now() WHERE id = $2`,
        [user ? user.id : anonymousId, petId],
      );

      // 4) 创建对话线程 + 领养记录（petType=species:<speciesId>）
      const petType = `${SPECIES_PET_TYPE_PREFIX}${pet.species_id}`;
      const petName = pet.nameZh;
      // 归属：登录用户写 users.id；游客 'anonymous' + anonymousId（登录后由 migrate 迁移）
      const ownerId = user ? user.id : "anonymous";
      const thr = await client.query(
        `INSERT INTO threads (user_id, anonymous_id, title) VALUES ($1, $2, $3) RETURNING id`,
        [ownerId, user ? null : anonymousId, `${petName}'s Home`],
      );
      const threadId = thr.rows[0].id;
      const ad = await client.query(
        `INSERT INTO adoptions (user_id, anonymous_id, thread_id, pet_name, pet_type)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [ownerId, user ? null : anonymousId, threadId, petName, petType],
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

      // —— NFR 确权：领养成功同步铸造数字藏品（游客无账号资产归属，暂不确权）——
      const traits = (pet.traits ?? {}) as Record<string, unknown>;
      let minted: Awaited<ReturnType<typeof mintCollectible>> | null = null;
      if (user) {
        minted = await mintCollectible(client, {
          ownerId: user.id,
          species: {
            speciesId: pet.species_id,
            nameZh: pet.nameZh,
            nameEn: pet.nameEn,
            category: pet.category,
            habitat: pet.habitat,
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
          adoptionId: String(ad.rows[0].id),
        });
      }

      await client.query("COMMIT");

      // 裂变活跃验证：被邀请人完成首次领养 → 释放冻结的邀请奖励（后台异步，失败不影响领养）
      if (user) {
        void releaseInviteReward(user.id).catch(() => {});
      }

      return NextResponse.json({
        ok: true,
        // P1 零摩擦领养：游客标记（前端据此展示「登录云同步」而非直接进聊天）
        guest: !user,
        adoption: { id: ad.rows[0].id, petType, petName },
        threadId,
        nfr: minted
          ? {
              id: minted.id,
              hashId: minted.hashId,
              collectibleId: minted.collectibleId,
              generation: Number(pet.generation ?? 1),
              lockedUntil: minted.lockedUntil,
            }
          : null,
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
