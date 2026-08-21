import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { renderPetDescription } from "@/lib/pet-dictionary";

export const runtime = "nodejs";

/** 进化链：3:1 递推，legendary 为顶点。 */
const CHAIN = ["common", "uncommon", "rare", "epic", "legendary"];

/**
 * POST /api/pets/evolve
 * 请求体：{ petIds: string[] }（3 只同物种、同稀有度、属于当前用户的 active 宠物）
 *
 * 事务（原子性保证：消耗与生成要么都成功，要么全部回滚）：
 *   1. SELECT ... FOR UPDATE 锁住 3 只（并发安全）；
 *   2. 校验：3 只同 species_id、同 traits.rarity、非 legendary 顶点；
 *   3. 创建新宠物：稀有度+1、generation=MAX+1、parent_ids=3 只来源、image_url 取该物种下一稀有度的 AI 图（兜底原图）；
 *   4. 3 只置 status='consumed'、evolution_id=新宠物 id（软删除，保留族谱）。
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const petIds = Array.isArray(body?.petIds)
      ? body.petIds.filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
      : [];
    if (petIds.length !== 3) {
      return NextResponse.json({ ok: false, error: apiError(locale, "invalidEvolveSet") }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1) 锁定并校验所有权 + active 状态
      const { rows } = await client.query(
        `SELECT id, species_id, image_url, traits, generation
           FROM pets
          WHERE id = ANY($1) AND owner_id = $2 AND status = 'active'
          FOR UPDATE`,
        [petIds, user.id],
      );
      if (rows.length !== 3) {
        throw Object.assign(new Error("owned"), { code: "invalidEvolveSet" });
      }

      // 2) 同物种 + 同稀有度
      const speciesId = rows[0].species_id;
      const rarity = rows[0].traits?.rarity ?? "common";
      const sameGroup = rows.every(
        (r) => r.species_id === speciesId && (r.traits?.rarity ?? "common") === rarity,
      );
      if (!sameGroup) {
        throw Object.assign(new Error("same"), { code: "notSameGroup" });
      }
      const idx = CHAIN.indexOf(rarity);
      if (idx === -1 || idx >= CHAIN.length - 1) {
        throw Object.assign(new Error("top"), { code: "legendaryTop" });
      }
      const nextRarity = CHAIN[idx + 1];

      // 3) 生成唯一新 id
      let newId = "";
      for (;;) {
        const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0").toUpperCase();
        const cand = `#${hex}`;
        const dup = await client.query("SELECT 1 FROM pets WHERE id = $1", [cand]);
        if (!dup.rows.length) {
          newId = cand;
          break;
        }
      }

      // 图片：该物种下一稀有度的华丽 AI 图（优先非占位）；兜底用第一只的原图
      const { rows: imgRows } = await client.query(
        `SELECT image_url FROM pets
          WHERE species_id = $1 AND traits->>'rarity' = $2 AND image_url NOT LIKE '/resources/%'
          ORDER BY random() LIMIT 1`,
        [speciesId, nextRarity],
      );
      const imageUrl = imgRows[0]?.image_url ?? rows[0].image_url;
      const generation = Math.max(...rows.map((r) => Number(r.generation || 1))) + 1;
      const newTraits = { ...(rows[0].traits ?? {}), rarity: nextRarity };

      const { rows: inserted } = await client.query(
        `INSERT INTO pets (id, species_id, image_url, traits, generation, parent_ids, owner_id, adopted_at, status)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, now(), 'active')
         RETURNING id, species_id, image_url, traits, generation, parent_ids, adopted_at`,
        [
          newId,
          speciesId,
          imageUrl,
          JSON.stringify(newTraits),
          generation,
          JSON.stringify(rows.map((r) => r.id)),
          user.id,
        ],
      );
      const newPet = inserted[0];

      // 4) 消耗 3 只（软删除 + 记录进化来源）
      await client.query(
        `UPDATE pets SET status = 'consumed', evolution_id = $1 WHERE id = ANY($2)`,
        [newId, petIds],
      );

      await client.query("COMMIT");

      // 附带物种信息 + 默认介绍
      const { rows: spRows } = await client.query(
        `SELECT id, name_zh AS "nameZh", name_en AS "nameEn", category, habitat,
                default_description_zh AS "defaultDescriptionZh",
                default_description_en AS "defaultDescriptionEn"
           FROM pet_dictionary WHERE id = $1`,
        [speciesId],
      );
      const sp = spRows[0];
      return NextResponse.json({
        ok: true,
        consumedIds: petIds,
        pet: {
          id: newPet.id,
          speciesId: newPet.species_id,
          speciesName: locale === "en" ? sp?.nameEn : sp?.nameZh,
          imageUrl: newPet.image_url,
          traits: newPet.traits ?? {},
          generation: Number(newPet.generation),
          parentIds: newPet.parent_ids,
          defaultDescription: renderPetDescription(sp, newPet.traits, locale),
        },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "invalidEvolveSet" || code === "notSameGroup" || code === "legendaryTop") {
      return NextResponse.json({ ok: false, error: apiError(locale, code) }, { status: 400 });
    }
    console.error("[pets/evolve] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(locale, "evolveFailed") }, { status: 500 });
  }
}
