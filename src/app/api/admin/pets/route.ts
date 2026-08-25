import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { adminError, requireAdmin } from "@/lib/admin-guard";
import { resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/admin/pets?page=1&pageSize=20&species=&rarity=
 * 宠物管理列表：分页 + 按物种 / 稀有度筛选 + 可见性/持有信息。
 */
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const locale = resolveLocale(req);
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20) || 20));
  const species = url.searchParams.get("species") ?? "";
  const rarity = url.searchParams.get("rarity") ?? "";

  const params: unknown[] = [];
  const where: string[] = [];
  if (species) {
    params.push(species);
    where.push(`p.species_id = $${params.length}`);
  }
  if (rarity) {
    params.push(rarity);
    where.push(`p.traits->>'rarity' = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.push(pageSize, (page - 1) * pageSize);

  try {
    const [{ rows: list }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT p.id, p.species_id, p.image_url, p.traits, p.generation, p.custom_description,
                p.visible, p.status, p.owner_id,
                d.name_zh AS "nameZh", d.name_en AS "nameEn"
           FROM pets p
           JOIN pet_dictionary d ON d.id = p.species_id
           ${whereSql}
          ORDER BY p.created_at DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      ),
      pool.query(`SELECT count(*)::int AS n FROM pets p ${whereSql}`, params.slice(0, params.length - 2)),
    ]);

    return NextResponse.json({
      ok: true,
      total: countRows[0]?.n ?? 0,
      pets: list.map((r) => ({
        id: r.id,
        speciesId: r.species_id,
        speciesName: locale === "en" ? r.nameEn : r.nameZh,
        imageUrl: r.image_url,
        traits: r.traits ?? {},
        generation: Number(r.generation),
        customDescription: r.custom_description,
        visible: !!r.visible,
        status: r.status,
        owned: r.owner_id != null,
      })),
    });
  } catch (err) {
    console.error("[admin/pets]", err);
    return adminError();
  }
}
