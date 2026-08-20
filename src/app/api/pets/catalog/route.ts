import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { resolveLocale } from "@/i18n/api-errors";
import { renderPetDescription } from "@/lib/pet-dictionary";

export const runtime = "nodejs";

/**
 * GET /api/pets/catalog — 宠物图鉴（预计算 pets + 字典 JOIN）。
 * 查询参数：
 *   category=猫科          按字典分类浏览
 *   species=snow_leopard   按物种浏览
 *   element=fire / rarity=rare / personality=勇敢  基因筛选（traits @> jsonb，命中 GIN 索引）
 *   mine=1                 只看当前登录用户已领养的
 *   limit=50 offset=0      分页
 * 返回每个宠物附带 species 信息 + 按 locale 渲染的默认介绍。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const url = new URL(req.url);
  const category = url.searchParams.get("category")?.trim() || "";
  const species = url.searchParams.get("species")?.trim() || "";
  const element = url.searchParams.get("element")?.trim() || "";
  const rarity = url.searchParams.get("rarity")?.trim() || "";
  const personality = url.searchParams.get("personality")?.trim() || "";
  const mine = url.searchParams.get("mine") === "1";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

  const where: string[] = [];
  const params: unknown[] = [];
  if (mine) {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "signInFirst" }, { status: 401 });
    }
    params.push(user.id);
    where.push(`p.owner_id = $${params.length}`);
  }
  if (category) {
    params.push(category);
    where.push(`d.category = $${params.length}`);
  }
  if (species) {
    params.push(species);
    where.push(`p.species_id = $${params.length}`);
  }
  // traits @> jsonb 子集 → 命中 idx_pets_traits_gin（毫秒级）
  const traitFilter: Record<string, string> = {};
  if (element) traitFilter.element = element;
  if (rarity) traitFilter.rarity = rarity;
  if (personality) traitFilter.personality = personality;
  if (Object.keys(traitFilter).length) {
    params.push(JSON.stringify(traitFilter));
    where.push(`p.traits @> $${params.length}::jsonb`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT p.id, p.species_id, p.image_url, p.traits, p.generation, p.parent_ids,
            p.custom_description, p.owner_id, p.adopted_at,
            d.name_zh AS "nameZh", d.name_en AS "nameEn", d.category, d.habitat,
            d.default_description_zh AS "defaultDescriptionZh",
            d.default_description_en AS "defaultDescriptionEn"
       FROM pets p
       JOIN pet_dictionary d ON d.id = p.species_id
       ${whereSql}
      ORDER BY p.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  // 图鉴分类导航（来自宠物字典）
  const { rows: cats } = await pool.query(
    `SELECT DISTINCT category FROM pet_dictionary ORDER BY category`,
  );

  const pets = rows.map((r) => {
    const speciesRow = {
      defaultDescriptionZh: r.defaultDescriptionZh,
      defaultDescriptionEn: r.defaultDescriptionEn,
    };
    return {
      id: r.id,
      speciesId: r.species_id,
      speciesName: locale === "en" ? r.nameEn : r.nameZh,
      category: r.category,
      habitat: r.habitat,
      imageUrl: r.image_url,
      traits: r.traits ?? {},
      generation: Number(r.generation),
      parentIds: r.parent_ids,
      customDescription: r.custom_description ?? null,
      defaultDescription: renderPetDescription(speciesRow, r.traits, locale),
      owned: r.owner_id != null,
      adoptedAt: r.adopted_at,
    };
  });

  return NextResponse.json({
    ok: true,
    pets,
    count: pets.length,
    categories: cats.map((c) => c.category),
  });
}
