import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { adminError, requireAdmin } from "@/lib/admin-guard";

export const runtime = "nodejs";

/**
 * POST /api/admin/users/[id]/grant-pet  { speciesId?: string, rarity?: string }
 * 站长发放稀有宠物（活动奖励 / 客诉补偿）：
 *  - 优先分配池中未领养稀有宠物（rare/epic/legendary）；
 *  - 指定 speciesId 时按物种匹配；
 *  - 池空则按字典新建一只（默认图 + 指定稀有度）。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const speciesId = typeof body.speciesId === "string" && body.speciesId ? body.speciesId : null;
  const rarity = typeof body.rarity === "string" ? body.rarity : "rare";

  try {
    const target = await pool.query(`SELECT id FROM users WHERE id = $1::uuid`, [id]);
    if (!target.rows.length) {
      return NextResponse.json({ ok: false, error: "user not found" }, { status: 404 });
    }

    // 1) 池中分配未领养宠物（指定物种则按物种；否则任选稀有）
    const poolSql = speciesId
      ? `SELECT id FROM pets WHERE owner_id IS NULL AND status='active' AND species_id=$1 ORDER BY random() LIMIT 1`
      : `SELECT id FROM pets WHERE owner_id IS NULL AND status='active'
           AND traits->>'rarity' IN ('rare','epic','legendary') ORDER BY random() LIMIT 1`;
    const picked = await pool.query(poolSql, speciesId ? [speciesId] : []);
    let petId: string | null = null;

    if (picked.rows.length) {
      petId = picked.rows[0].id;
      await pool.query(
        `UPDATE pets SET owner_id = $1::uuid, adopted_at = now() WHERE id = $2`,
        [id, petId],
      );
    } else {
      // 2) 池空 → 按字典新建
      const sp = await pool.query(
        `SELECT id FROM pet_dictionary ${speciesId ? `WHERE id = $1` : `ORDER BY random() LIMIT 1`}`,
        speciesId ? [speciesId] : [],
      );
      if (!sp.rows.length) {
        return NextResponse.json({ ok: false, error: "species not found" }, { status: 400 });
      }
      const sid = sp.rows[0].id;
      const img = await pool.query(`SELECT image_url FROM pets WHERE species_id = $1 AND image_url LIKE '/images/pets/%' LIMIT 1`, [sid]);
      const imageUrl = img.rows[0]?.image_url ?? "/resources/pet/fox2.webp";
      petId = `#` + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0").toUpperCase();
      await pool.query(
        `INSERT INTO pets (id, species_id, image_url, traits, generation, parent_ids, custom_description, owner_id, adopted_at)
         VALUES ($1, $2, $3, $4::jsonb, 1, NULL, NULL, $5::uuid, now())`,
        [petId, sid, imageUrl, JSON.stringify({ element: "earth", rarity, personality: "温柔" }), id],
      );
    }

    return NextResponse.json({ ok: true, petId, rarity, to: id });
  } catch (err) {
    console.error("[admin/users/grant-pet]", err);
    return adminError();
  }
}
