import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { weightedPick, randomDna } from "@/lib/blindbox";
import { mintCollectible } from "@/lib/nfr";
import { postBreedShare } from "@/lib/social-poster";

export const runtime = "nodejs";

/**
 * POST /api/blindbox/draw   — 盲盒抽奖（积分通道）
 * 请求体：{ poolId: string }
 *
 * 事务（扣费 / 铸造 / 写日志 同一事务，任何失败 → ROLLBACK，绝不「扣钱没抽到」）：
 *   1. FOR UPDATE 锁定奖池（防并发状态变更 / 超卖）；
 *   2. 原子扣积分（points >= price_points 才成功）并写积分流水；
 *   3. 加权随机抽取稀有度（weightedPick）；
 *   4. 从物种白名单（或全部字典）随机选物种；
 *   5. mintCollectible 铸造 NFR（同一事务）；
 *   6. 写 blindbox_logs 抽奖流水（结果可溯源）；
 *   7. 抽中传说 → COMMIT 后异步触发社交炫耀（非阻塞，失败不影响结果）。
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const poolId = typeof body?.poolId === "string" ? body.poolId.trim() : "";
    if (!poolId) {
      return NextResponse.json({ ok: false, error: apiError(locale, "invalidBlindboxPool") }, { status: 400 });
    }

    await ensureDbSchemaOnce();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1) 锁定奖池并校验激活
      const { rows: poolRows } = await client.query(
        `SELECT id, name_zh AS "nameZh", name_en AS "nameEn", price_cny AS "priceCny",
                price_points AS "pricePoints", probabilities, species_ids AS "speciesIds",
                is_active AS "isActive"
           FROM blindbox_pools
          WHERE id = $1
          FOR UPDATE`,
        [poolId],
      );
      const poolRow = poolRows[0];
      if (!poolRow || poolRow.isActive === false) {
        await client.query("ROLLBACK");
        return NextResponse.json({ ok: false, error: apiError(locale, "blindboxUnavailable") }, { status: 404 });
      }
      const pricePoints = Number(poolRow.pricePoints ?? 200);

      // 2) 原子扣积分（行锁：points >= price_points 才成功）
      const cost = await client.query(
        `UPDATE users SET points = points - $1 WHERE id = $2 AND points >= $1`,
        [pricePoints, user.id],
      );
      if (cost.rowCount === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ ok: false, error: apiError(locale, "notEnoughPoints") }, { status: 402 });
      }
      await client.query(
        `INSERT INTO points_log (user_id, amount, reason) VALUES ($1, $2, 'blindbox')`,
        [user.id, -pricePoints],
      );
      // 3) 加权随机抽取稀有度
      const probabilities = (poolRow.probabilities ?? {}) as Record<string, number>;
      const rarity = weightedPick(probabilities);
      const isLegendary = rarity === "legendary";

      // 4) 随机选物种（白名单优先，空 = 全部字典物种）
      const speciesList = Array.isArray(poolRow.speciesIds) && poolRow.speciesIds.length > 0
        ? (poolRow.speciesIds as string[])
        : (await client.query(`SELECT id FROM pet_dictionary`)).rows.map((r) => String(r.id));
      const speciesId = speciesList[Math.floor(Math.random() * speciesList.length)];
      const { rows: spRows } = await client.query(
        `SELECT d.id, d.name_zh AS "nameZh", d.name_en AS "nameEn", d.category, d.habitat,
                (SELECT p.image_url FROM pets p
                  WHERE p.species_id = d.id AND p.image_url IS NOT NULL LIMIT 1) AS "imageUrl"
           FROM pet_dictionary d WHERE d.id = $1 LIMIT 1`,
        [speciesId],
      );
      const sp = spRows[0];
      if (!sp) {
        await client.query("ROLLBACK");
        return NextResponse.json({ ok: false, error: apiError(locale, "blindboxSpeciesMissing") }, { status: 500 });
      }

      // 5) 铸造 NFR（复用 mintCollectible，同一事务）
      const dna = randomDna();
      const minted = await mintCollectible(client, {
        ownerId: user.id,
        species: {
          speciesId: String(sp.id),
          nameZh: String(sp.nameZh),
          nameEn: String(sp.nameEn),
          category: String(sp.category),
          habitat: sp.habitat ? String(sp.habitat) : null,
          rarity,
          element: dna.element,
          imageUrl: String(sp.imageUrl ?? ""),
        },
        dna: { ...dna, rarity },
        generation: 1,
        parentHashIds: null,
        sourcePetId: null,
        adoptionId: null,
      });

      // 6) 写抽奖流水（同一事务）
      await client.query(
        `INSERT INTO blindbox_logs
           (user_id, pool_id, result_collectible_id, result_hash_id, is_legendary, pay_method, cost)
         VALUES ($1, $2, $3, $4, $5, 'points', $6)`,
        [user.id, poolId, minted.collectibleId, minted.hashId, isLegendary, pricePoints],
      );

      await client.query("COMMIT");

      // 7) 社交炫耀：传说级 → 异步非阻塞（失败仅记录日志，不影响抽奖结果）
      if (isLegendary) {
        void postBreedShare({
          speciesName: String(sp.nameZh),
          rarity: "legendary",
          element: dna.element,
          generation: 1,
          hashId: minted.hashId,
        }).catch((err) => console.error("[blindbox] 社交分享异常(非阻塞):", err));
      }

      return NextResponse.json({
        ok: true,
        isLegendary,
        rarity,
        poolId,
        nfr: {
          id: minted.id,
          hashId: minted.hashId,
          collectibleId: minted.collectibleId,
          speciesId: String(sp.id),
          speciesName: locale === "en" ? String(sp.nameEn) : String(sp.nameZh),
          rarity,
          element: dna.element,
          generation: 1,
          imageUrl: String(sp.imageUrl ?? ""),
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
    console.error("[blindbox/draw] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(locale, "blindboxFailed") }, { status: 500 });
  }
}
