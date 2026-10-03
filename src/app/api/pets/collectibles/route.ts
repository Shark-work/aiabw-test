import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/pets/collectibles — 当前用户的 NFR 确权实例列表（个体维度）
 * 与 /api/gallery（定义维度：物种×稀有度聚合 holdings）互补：
 * 繁育（/api/pets/breed）与转赠（/api/pets/transfer）作用于 user_collectibles 个体，
 * 需要实例 id 与双冷却字段（locked_until / breed_cooldown_until），故单设本端点。
 * 鉴权：Bearer；未登录 401。
 * 响应 items[]：{ id, collectibleId, speciesId, name, rarity, element, imageUrl,
 *   generation, hashId, lockedUntil, breedCooldownUntil, mintedAt }
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "signInFirst") },
        { status: 401 },
      );
    }

    await ensureDbSchemaOnce();
    const { rows } = await pool.query(
      `SELECT uc.id, uc.collectible_id AS "collectibleId", uc.generation,
              uc.hash_id AS "hashId",
              uc.locked_until AS "lockedUntil",
              uc.breed_cooldown_until AS "breedCooldownUntil",
              uc.minted_at AS "mintedAt",
              dc.species_id AS "speciesId", dc.name_zh, dc.name_en,
              dc.rarity, dc.element, dc.base_image_url AS "imageUrl"
         FROM user_collectibles uc
         JOIN digital_collectibles dc ON dc.id = uc.collectible_id
        WHERE uc.owner_id = $1 AND uc.status = 'active'
        ORDER BY uc.minted_at DESC`,
      [user.id],
    );

    const items = rows.map((r) => ({
      id: String(r.id),
      collectibleId: String(r.collectibleId),
      speciesId: String(r.speciesId),
      name: locale === "en" ? String(r.name_en) : String(r.name_zh),
      rarity: String(r.rarity),
      element: r.element ? String(r.element) : null,
      imageUrl: String(r.imageUrl),
      generation: Number(r.generation),
      hashId: String(r.hashId),
      lockedUntil: new Date(r.lockedUntil as string).toISOString(),
      breedCooldownUntil: new Date(r.breedCooldownUntil as string).toISOString(),
      mintedAt: new Date(r.mintedAt as string).toISOString(),
    }));

    return NextResponse.json({ ok: true, items });
  } catch (err) {
    console.error("[pets/collectibles] failed:", err);
    return NextResponse.json(
      { ok: false, error: "collectibles_load_failed" },
      { status: 500 },
    );
  }
}
