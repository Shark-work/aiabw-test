import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { renderPetDescription } from "@/lib/pet-dictionary";

export const runtime = "nodejs";

/** 兑换价格：≈ 用户 5-7 天的活跃积累（目标渐进效应 + 损失厌恶）。 */
const REDEEM_PRICE = 500;

/**
 * POST /api/points/redeem-pet
 * 请求头：Authorization: Bearer <token>
 *
 * 心理学激励：每天限兑 1 次（稀缺）+ 500 积分的“跳一跳够得着”目标。
 * 事务（原子性）：
 *   1. 今天已兑换 → 拒绝；
 *   2. 积分 < 500 → 拒绝；
 *   3. UPDATE users SET points = points - 500（原子，防并发超扣）；
 *   4. INSERT points_log（-500）；
 *   5. 从预计算池原子分配一只未领养 Common 宠物（FOR UPDATE SKIP LOCKED）；
 *      池空则新建一只 Common 基础宠物（兜底）。
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1) 每天限 1 次：查 points_log 今天是否有 redeem_pet
      const { rows: todayRows } = await client.query(
        `SELECT 1 FROM points_log
          WHERE user_id = $1 AND reason = 'redeem_pet'
            AND created_at >= date_trunc('day', now())
          LIMIT 1`,
        [user.id],
      );
      if (todayRows.length) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { ok: false, error: apiError(locale, "redeemAlready") },
          { status: 429 },
        );
      }

      // 2+3) 原子扣积分（points >= 500 才扣，防止并发超扣）
      const deduct = await client.query(
        `UPDATE users SET points = points - $1
          WHERE id = $2 AND points >= $1
          RETURNING points`,
        [REDEEM_PRICE, user.id],
      );
      if (!deduct.rows.length) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { ok: false, error: apiError(locale, "notEnoughPoints") },
          { status: 400 },
        );
      }
      const remaining = Number(deduct.rows[0].points);

      // 4) 积分流水
      await client.query(
        `INSERT INTO points_log (user_id, amount, reason) VALUES ($1, $2, 'redeem_pet')`,
        [user.id, -REDEEM_PRICE],
      );

      // 5) 盲盒开奖：必得 Common，20% 概率 Uncommon
      const roll = Math.random() < 0.2 ? "uncommon" : "common";
      const { rows: assigned } = await client.query(
        `WITH chosen AS (
           SELECT id FROM pets
            WHERE owner_id IS NULL AND status = 'active'
              AND traits->>'rarity' = $2
            ORDER BY random()
            LIMIT 1
            FOR UPDATE SKIP LOCKED
         )
         UPDATE pets p
            SET owner_id = $1, adopted_at = now()
           FROM chosen c
          WHERE p.id = c.id
          RETURNING p.id, p.species_id, p.image_url, p.traits, p.generation, p.parent_ids, p.custom_description, p.adopted_at`,
        [user.id, roll],
      );

      let pet = assigned[0];
      if (!pet) {
        // 兜底：池无 Common 时新建一只（随机物种）
        const { rows: sp } = await client.query(
          `SELECT id FROM pet_dictionary ORDER BY random() LIMIT 1`,
        );
        const speciesId = sp[0]?.id ?? "fox";
        const { rows: img } = await client.query(
          `SELECT image_url FROM pets WHERE species_id = $1
            AND image_url NOT LIKE '/resources/%' LIMIT 1`,
          [speciesId],
        );
        let newId = "";
        for (;;) {
          const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0").toUpperCase();
          const cand = `#${hex}`;
          const dup = await client.query("SELECT 1 FROM pets WHERE id = $1", [cand]);
          if (!dup.rows.length) { newId = cand; break; }
        }
        const { rows: ins } = await client.query(
          `INSERT INTO pets (id, species_id, image_url, traits, generation, owner_id, adopted_at, status)
           VALUES ($1, $2, $3, $4::jsonb, 1, $5, now(), 'active')
           RETURNING id, species_id, image_url, traits, generation, parent_ids, custom_description, adopted_at`,
          [
            newId,
            speciesId,
            img[0]?.image_url ?? "/resources/pet/fox2.webp",
            JSON.stringify({ element: "earth", rarity: roll, personality: "温柔" }),
            user.id,
          ],
        );
        pet = ins[0];
      }

      await client.query("COMMIT");

      // 附带物种名 + 默认介绍
      const { rows: spRows } = await client.query(
        `SELECT id, name_zh AS "nameZh", name_en AS "nameEn", category, habitat,
                default_description_zh AS "defaultDescriptionZh",
                default_description_en AS "defaultDescriptionEn"
           FROM pet_dictionary WHERE id = $1`,
        [pet.species_id],
      );
      const sp = spRows[0];
      return NextResponse.json({
        ok: true,
        points: remaining,
        price: REDEEM_PRICE,
        pet: {
          id: pet.id,
          speciesId: pet.species_id,
          speciesName: locale === "en" ? sp?.nameEn : sp?.nameZh,
          imageUrl: pet.image_url,
          traits: pet.traits ?? {},
          defaultDescription: renderPetDescription(sp, pet.traits, locale),
        },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[points/redeem-pet] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(locale, "redeemFailed") }, { status: 500 });
  }
}
