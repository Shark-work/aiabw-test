import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { renderPetDescription } from "@/lib/pet-dictionary";
import { resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/pets/featured?count=3
 * 首页「基础宠物展示」动态推荐池：
 *  - 候选条件：未领养宠物中，稀缺宠物（rarity ∈ rare/epic/legendary，图鉴最稀有）
 *    OR 热门物种（该物种累计被领养数 ≥ 3，adoption_count 高 = 用户最喜欢）；
 *  - 随机抽取：每次请求随机排序取 N 只 → 每次刷新首页都有新鲜感；
 *  - 字段与图鉴保持一致（speciesName 按 locale 映射 + 字典默认描述）。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const url = new URL(req.url);
  const count = Math.max(1, Math.min(Number(url.searchParams.get("count") ?? 3) || 3, 6));

  const { rows } = await pool.query(
    `WITH stats AS (
       SELECT species_id, count(*) FILTER (WHERE owner_id IS NOT NULL) AS adopted
         FROM pets WHERE status = 'active' GROUP BY species_id
     )
     SELECT p.id, p.species_id, p.image_url, p.traits, p.generation,
            d.name_zh AS "nameZh", d.name_en AS "nameEn", d.category,
            d.default_description_zh AS "defaultDescriptionZh",
            d.default_description_en AS "defaultDescriptionEn",
            COALESCE(s.adopted, 0) AS adopted,
            (p.traits->>'rarity' IN ('rare','epic','legendary')) AS is_rare
       FROM pets p
       JOIN pet_dictionary d ON d.id = p.species_id
       LEFT JOIN stats s ON s.species_id = p.species_id
      WHERE p.status = 'active' AND p.owner_id IS NULL
        AND (p.traits->>'rarity' IN ('rare','epic','legendary') OR COALESCE(s.adopted, 0) >= 3)
      ORDER BY random()
      LIMIT $1`,
    [count],
  );

  const featured = rows.map((r) => ({
    id: r.id,
    speciesId: r.species_id,
    speciesName: locale === "en" ? r.nameEn : r.nameZh,
    category: r.category,
    imageUrl: r.image_url,
    traits: r.traits ?? {},
    generation: Number(r.generation),
    defaultDescription: renderPetDescription(
      {
        defaultDescriptionZh: r.defaultDescriptionZh,
        defaultDescriptionEn: r.defaultDescriptionEn,
      },
      r.traits,
      locale,
    ),
    adopted: Number(r.adopted),
    isRare: !!r.is_rare,
  }));

  return NextResponse.json({ ok: true, pets: featured });
}
