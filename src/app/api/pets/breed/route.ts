import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import {
  breedDna,
  BREED_COST,
  BREED_COOLDOWN_MS,
  type Dna,
} from "@/lib/genetics";
import { mintCollectible } from "@/lib/nfr";

export const runtime = "nodejs";

/**
 * POST /api/pets/breed   — 数字藏品繁育（NFR 遗传算法）
 * 请求体：{ parentIds: string[] }（恰好 2 只属于当前用户的 user_collectibles.id）
 *
 * 事务（任何环节失败 → ROLLBACK，绝不出现「扣了积分但没生出宠物」）：
 *   1. SELECT ... FOR UPDATE 锁定 2 只亲本（防并发转赠/消耗）；
 *   2. 校验：2 只均归属当前用户 + 同物种 + 亲本繁育冷却已过；
 *   3. 原子扣积分（points >= BREED_COST 才允许）并写积分流水；
 *   4. 基因遗传算法生成子代 DNA（元素交叉/性格变异/稀有度保底）；
 *   5. 创建 pets 实例 + adoptions 线程（子代可进入「我的宠物」聊天）；
 *   6. 铸造 NFR（mintCollectible：藏品定义 upsert + 确权记录 + 发行量自增）；
 *   7. 重置亲本繁育冷却期（7 天）。
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
    const parentIds = Array.isArray(body?.parentIds)
      ? body.parentIds.filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
      : [];
    if (parentIds.length !== 2) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "invalidBreedSet") },
        { status: 400 },
      );
    }

    await ensureDbSchemaOnce();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1) 锁定亲本（FOR UPDATE OF 锁确权表行）并校验归属
      const { rows: parents } = await client.query(
        `SELECT uc.id, uc.owner_id, uc.collectible_id, uc.dna_sequence, uc.generation,
                uc.hash_id, uc.breed_cooldown_until, uc.status,
                dc.species_id, dc.name_zh, dc.name_en, dc.category, dc.habitat,
                dc.rarity, dc.element, dc.base_image_url
           FROM user_collectibles uc
           JOIN digital_collectibles dc ON dc.id = uc.collectible_id
          WHERE uc.id = ANY($1) AND uc.owner_id = $2 AND uc.status = 'active'
          FOR UPDATE OF uc`,
        [parentIds, user.id],
      );
      if (parents.length !== 2) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { ok: false, error: apiError(locale, "parentNotFound") },
          { status: 404 },
        );
      }

      // 2) 同物种校验（第一阶段保真）
      if (parents[0].species_id !== parents[1].species_id) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { ok: false, error: apiError(locale, "breedDifferentSpecies") },
          { status: 400 },
        );
      }

      // 3) 亲本繁育冷却校验
      const now = new Date();
      for (const p of parents) {
        if (new Date(p.breed_cooldown_until as string) > now) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            {
              ok: false,
              error: apiError(locale, "breedCooldown"),
              retryAfter: Math.ceil(
                (new Date(p.breed_cooldown_until as string).getTime() - now.getTime()) / 1000,
              ),
            },
            { status: 429 },
          );
        }
      }

      // 4) 原子扣积分（行锁：points >= cost 才成功）
      const cost = await client.query(
        `UPDATE users SET points = points - $1 WHERE id = $2 AND points >= $1`,
        [BREED_COST, user.id],
      );
      if (cost.rowCount === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { ok: false, error: apiError(locale, "notEnoughPoints") },
          { status: 402 },
        );
      }
      await client.query(
        `INSERT INTO points_log (user_id, amount, reason) VALUES ($1, $2, 'breed')`,
        [user.id, -BREED_COST],
      );
      // 5) 基因遗传算法
      const dnaA = (parents[0].dna_sequence ?? {}) as Dna;
      const dnaB = (parents[1].dna_sequence ?? {}) as Dna;
      const childDna = breedDna(dnaA, dnaB);
      const generation =
        Math.max(Number(parents[0].generation ?? 1), Number(parents[1].generation ?? 1)) + 1;
      const parentHashIds = [String(parents[0].hash_id), String(parents[1].hash_id)];
      const speciesId = String(parents[0].species_id);

      // 6) 创建 pets 实例（唯一 #HEX id）+ adoptions 线程（子代可对话）
      let petId = "";
      for (;;) {
        const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0").toUpperCase();
        const cand = `#${hex}`;
        const dup = await client.query("SELECT 1 FROM pets WHERE id = $1", [cand]);
        if (!dup.rows.length) {
          petId = cand;
          break;
        }
      }
      await client.query(
        `INSERT INTO pets (id, species_id, image_url, traits, generation, parent_ids, owner_id, adopted_at, status)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, now(), 'active')`,
        [
          petId,
          speciesId,
          parents[0].base_image_url,
          JSON.stringify(childDna),
          generation,
          JSON.stringify([parents[0].collectible_id, parents[1].collectible_id]),
          user.id,
        ],
      );
      const petName = locale === "en" ? String(parents[0].name_en) : String(parents[0].name_zh);
      const thread = await client.query(
        `INSERT INTO threads (user_id, title) VALUES ($1, $2) RETURNING id`,
        [user.id, `${petName}'s Home`],
      );
      const adoption = await client.query(
        `INSERT INTO adoptions (user_id, thread_id, pet_name, pet_type)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [user.id, thread.rows[0].id, petName, `species:${speciesId}`],
      );
      await client.query(
        `INSERT INTO messages (thread_id, role, parts) VALUES ($1, 'assistant', $2::jsonb)`,
        [
          thread.rows[0].id,
          JSON.stringify([
            {
              type: "text",
              text:
                locale === "en"
                  ? `Hi! I'm ${petName} - a brand new companion born from breeding!`
                  : `嗨！我是${petName}，是繁育诞生的新伙伴~`,
            },
          ]),
        ],
      );

      // 7) 铸造 NFR 确权
      const minted = await mintCollectible(client, {
        ownerId: user.id,
        species: {
          speciesId,
          nameZh: String(parents[0].name_zh),
          nameEn: String(parents[0].name_en),
          category: String(parents[0].category),
          habitat: parents[0].habitat ? String(parents[0].habitat) : null,
          rarity: String(parents[0].rarity),
          element: parents[0].element ? String(parents[0].element) : undefined,
          imageUrl: String(parents[0].base_image_url),
        },
        dna: childDna,
        generation,
        parentHashIds,
        sourcePetId: petId,
        adoptionId: String(adoption.rows[0].id),
      });

      // 8) 重置亲本繁育冷却期
      await client.query(
        `UPDATE user_collectibles SET breed_cooldown_until = $1 WHERE id = ANY($2)`,
        [new Date(Date.now() + BREED_COOLDOWN_MS), parentIds],
      );

      await client.query("COMMIT");

      return NextResponse.json({
        ok: true,
        breedCost: BREED_COST,
        parentHashIds,
        nfr: {
          id: minted.id,
          hashId: minted.hashId,
          collectibleId: minted.collectibleId,
          speciesId,
          speciesName: petName,
          generation,
          dna: childDna,
          sourcePetId: petId,
          adoptionId: String(adoption.rows[0].id),
          lockedUntil: minted.lockedUntil,
          breedCooldownUntil: minted.breedCooldownUntil,
        },
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "nfrSupplyExhausted") {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "nfrSupplyExhausted") },
        { status: 409 },
      );
    }
    console.error("[pets/breed] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "breedFailed") },
      { status: 500 },
    );
  }
}
