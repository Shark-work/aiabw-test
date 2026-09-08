import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { resolveLocale } from "@/i18n/api-errors";
import { renderPetDescription } from "@/lib/pet-dictionary";
import { groupBySpecies } from "@/lib/species-group";

export const runtime = "nodejs";

/**
 * GET /api/pets/catalog — 宠物图鉴（预计算 pets + 字典 JOIN）。
 * 查询参数：
 *   category=猫科          按字典分类浏览
 *   species=snow_leopard   按物种浏览
 *   element=fire / rarity=rare / personality=勇敢  元素筛选（traits @> jsonb，命中 GIN 索引）
 *   mine=1                 只看当前登录用户已领养的
 *   group=species          物种聚合模式：同 species_id 多实例去重为一张卡
 *                          - 卡片展示 rep（稀有度最高记录），variantCount = 物种全量版本种数；
 *                          - id = 组内未拥有的最高稀有度实例（领养目标，最高档领光自动降级）；
 *                          - owned = 全部版本均被领养；limit/offset 按物种数分页。
 *   limit=50 offset=0      分页（group=species 时作用于物种而非实例）
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
  const group = url.searchParams.get("group")?.trim() === "species";
  // P1 零摩擦领养：游客设备标识（无需登录，用于 guest_owner 归属判定）
  const anonymousId = url.searchParams.get("anonymousId")?.trim() || "";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

  const where: string[] = [`p.status = 'active'`];
  const params: unknown[] = [];
  if (mine) {
    const user = await getUserFromRequest(req);
    if (user) {
      params.push(user.id);
      where.push(`p.owner_id = $${params.length}`);
    } else if (anonymousId) {
      // 游客：按本设备占位（guest_owner）过滤
      params.push(anonymousId);
      where.push(`p.guest_owner = $${params.length}`);
    } else {
      return NextResponse.json({ ok: false, error: "signInFirst" }, { status: 401 });
    }
  } else {
    // 站长下架的宠物对普通用户图鉴不可见（管理员后台控制上架/下架）
    where.push(`p.visible = true`);
  }
  if (category) {
    params.push(category);
    // 兼容 zh/en 传参：分类原文或英文名均可命中
    where.push(`(d.category = $${params.length} OR d.category_en = $${params.length})`);
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
  // 聚合模式需拉取组内全部实例（稀有度排序/领养目标判定），行级上限放宽；
  // 分页（limit/offset）在聚合后按物种数执行，SQL 层不裁剪。
  const rowLimit = group ? 500 : limit;
  const rowOffset = group ? 0 : offset;
  params.push(rowLimit, rowOffset);

  const { rows } = await pool.query(
    `SELECT p.id, p.species_id, p.image_url, p.traits, p.generation, p.parent_ids,
            p.custom_description, p.owner_id, p.guest_owner, p.adopted_at, p.last_interaction_time,
            d.name_zh AS "nameZh", d.name_en AS "nameEn", d.category, d.category_en AS "categoryEn",
            d.habitat, d.habitat_en AS "habitatEn",
            d.default_description_zh AS "defaultDescriptionZh",
            d.default_description_en AS "defaultDescriptionEn"
       FROM pets p
       JOIN pet_dictionary d ON d.id = p.species_id
       ${whereSql}
      ORDER BY p.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  // 图鉴分类导航（按 locale 返回英文/中文，供筛选按钮显示）
  const { rows: cats } = await pool.query(
    locale === "en"
      ? `SELECT DISTINCT COALESCE(category_en, category) AS category FROM pet_dictionary ORDER BY category`
      : `SELECT DISTINCT category FROM pet_dictionary ORDER BY category`,
  );
  const categories = cats.map((c) => c.category);

  const pets = rows.map((r) => {
    const speciesRow = {
      defaultDescriptionZh: r.defaultDescriptionZh,
      defaultDescriptionEn: r.defaultDescriptionEn,
    };
    return {
      id: r.id,
      speciesId: r.species_id,
      speciesName: locale === "en" ? r.nameEn : r.nameZh,
      category: locale === "en" ? (r.categoryEn ?? r.category) : r.category,
      habitat: locale === "en" ? (r.habitatEn ?? r.habitat) : r.habitat,
      imageUrl: r.image_url,
      traits: r.traits ?? {},
      generation: Number(r.generation),
      parentIds: r.parent_ids,
      customDescription: r.custom_description ?? null,
      defaultDescription: renderPetDescription(speciesRow, r.traits, locale),
      // 已领养：账号（owner_id）或游客设备占位（guest_owner）均视为有主
      owned: r.owner_id != null || r.guest_owner != null,
      adoptedAt: r.adopted_at,
      lastInteractionTime: r.last_interaction_time,
    };
  });

  // 物种聚合模式：同 species_id 去重为一张卡（图鉴按物种而非实例展示）
  if (group) {
    // 物种客观版本种数（全量 active+visible 实例的 DISTINCT rarity，不受当前筛选影响）
    const { rows: variantRows } = await pool.query(
      `SELECT species_id AS sid, COUNT(DISTINCT traits->>'rarity') AS n
         FROM pets
        WHERE status = 'active' AND visible = true
        GROUP BY species_id`,
    );
    const variantMap = new Map(variantRows.map((r) => [String(r.sid), Number(r.n)]));

    const cards = groupBySpecies(pets).map((c) => {
      // 领养目标（未拥有的最高稀有度实例）；全领光时回退 rep 保持字段完整
      const base = c.claimTarget ?? c.rep;
      return {
        id: base.id,
        speciesId: c.speciesId,
        // 卡片展示字段一律取 rep（物种稀有度最高的记录）
        speciesName: c.rep.speciesName,
        category: c.rep.category,
        habitat: c.rep.habitat,
        imageUrl: c.rep.imageUrl,
        traits: c.rep.traits,
        defaultDescription: c.rep.defaultDescription,
        // 实例级字段取领养目标，保证领养后弹窗与实际一致
        generation: base.generation,
        parentIds: base.parentIds,
        customDescription: base.customDescription,
        adoptedAt: base.adoptedAt,
        lastInteractionTime: base.lastInteractionTime,
        // 全部版本被领养才算“已拥有”（否则按钮仍可领未领光的版本）
        owned: c.allOwned,
        variantCount: variantMap.get(c.speciesId) ?? c.variantCount,
      };
    });
    const page = cards.slice(offset, offset + limit);
    return NextResponse.json({
      ok: true,
      pets: page,
      count: page.length,
      total: cards.length,
      categories,
    });
  }

  return NextResponse.json({
    ok: true,
    pets,
    count: pets.length,
    categories,
  });
}
