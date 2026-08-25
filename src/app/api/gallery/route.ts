import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/gallery   — 数字藏品图鉴
 * 查询参数：category / rarity / element / mine=1
 *  - 返回 digital_collectibles 藏品定义列表（JOIN pet_dictionary 物种信息）；
 *  - 已登录用户：按 user_collectibles 持有情况标记 owned: true/false；
 *  - mine=1：只返回当前用户持有的藏品（含持有数量 holdings）。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  try {
    const url = new URL(req.url);
    const category = url.searchParams.get("category")?.trim() || "";
    const rarity = url.searchParams.get("rarity")?.trim() || "";
    const element = url.searchParams.get("element")?.trim() || "";
    const mine = url.searchParams.get("mine") === "1";

    await ensureDbSchemaOnce();

    const user = await getUserFromRequest(req);
    const where: string[] = ["dc.is_visible = true"];
    const params: unknown[] = [];
    if (category) {
      params.push(category);
      where.push(`dc.category = $${params.length}`);
    }
    if (rarity) {
      params.push(rarity);
      where.push(`dc.rarity = $${params.length}`);
    }
    if (element) {
      params.push(element);
      where.push(`dc.element = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // 当前用户持有的藏品集合
    const ownedSet = new Map<string, number>();
    if (user && !mine) {
      const { rows: held } = await pool.query(
        `SELECT collectible_id, count(*)::int AS n
           FROM user_collectibles
          WHERE owner_id = $1 AND status = 'active'
          GROUP BY collectible_id`,
        [user.id],
      );
      for (const r of held) ownedSet.set(String(r.collectible_id), Number(r.n));
    }

    let sql: string;
    let queryParams: unknown[] = params;
    if (mine && user) {
      sql = `SELECT dc.id, dc.species_id, dc.name_zh, dc.name_en, dc.category, dc.habitat,
                    dc.rarity, dc.element, dc.base_image_url AS "imageUrl",
                    dc.total_supply AS "totalSupply", dc.minted, dc.description_zh, dc.description_en,
                    count(uc.id)::int AS holdings
               FROM digital_collectibles dc
               JOIN user_collectibles uc ON uc.collectible_id = dc.id
              ${whereSql}
                AND uc.owner_id = $${params.length + 1} AND uc.status = 'active'
              GROUP BY dc.id
              ORDER BY dc.rarity ASC, dc.species_id ASC`;
      queryParams = [...params, user.id];
    } else {
      sql = `SELECT dc.id, dc.species_id, dc.name_zh, dc.name_en, dc.category, dc.habitat,
                    dc.rarity, dc.element, dc.base_image_url AS "imageUrl",
                    dc.total_supply AS "totalSupply", dc.minted, dc.description_zh, dc.description_en
               FROM digital_collectibles dc
              ${whereSql}
              ORDER BY dc.rarity ASC, dc.species_id ASC`;
    }
    const { rows } = await pool.query(sql, queryParams);

    const items = rows.map((r) => {
      const ownedCount = ownedSet.get(String(r.id)) ?? 0;
      return {
        id: String(r.id),
        speciesId: String(r.species_id),
        name: locale === "en" ? String(r.name_en) : String(r.name_zh),
        category: String(r.category),
        rarity: String(r.rarity),
        element: r.element ? String(r.element) : null,
        habitat: r.habitat ? String(r.habitat) : null,
        imageUrl: String(r.imageUrl),
        totalSupply: Number(r.totalSupply),
        minted: Number(r.minted),
        description: locale === "en" ? r.description_en : r.description_zh,
        owned: ownedCount > 0,
        holdings: Number(r.holdings ?? 0),
      };
    });

    return NextResponse.json({ ok: true, items, count: items.length });
  } catch (err) {
    console.error("[gallery] failed:", err);
    return NextResponse.json({ ok: false, error: "gallery_failed" }, { status: 500 });
  }
}
