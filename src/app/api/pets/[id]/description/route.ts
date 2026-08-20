import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { renderPetDescription, type PetTraits } from "@/lib/pet-dictionary";

export const runtime = "nodejs";

const MAX_LEN = 50;

/**
 * PATCH /api/pets/[id]/description
 * 请求体：{ description: string | null }
 *  - 非空字符串 → 更新 custom_description（≤50 字符，超长 400）；
 *  - 空字符串 / null → 恢复默认（custom_description = NULL）。
 * 仅宠物主人可改（校验 ownership）。
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const locale = resolveLocale(req);
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "missing pet id" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const raw = typeof body?.description === "string" ? body.description.trim() : "";

    const { rows: owned } = await pool.query(
      `SELECT id, species_id, image_url, traits, generation, parent_ids, custom_description
         FROM pets WHERE id = $1 AND owner_id = $2 LIMIT 1`,
      [id, user.id],
    );
    if (!owned.length) {
      return NextResponse.json({ ok: false, error: apiError(locale, "noPermissionPet") }, { status: 403 });
    }
    if (raw.length > MAX_LEN) {
      return NextResponse.json({ ok: false, error: `description must be ≤ ${MAX_LEN} chars` }, { status: 400 });
    }

    const next = raw.length ? raw : null;
    const { rows: updated } = await pool.query(
      `UPDATE pets SET custom_description = $1 WHERE id = $2 RETURNING custom_description`,
      [next, id],
    );

    // 返回最新默认介绍（若恢复默认）
    const { rows: speciesRows } = await pool.query(
      `SELECT default_description_zh AS "defaultDescriptionZh",
              default_description_en AS "defaultDescriptionEn"
         FROM pet_dictionary WHERE id = $1`,
      [owned[0].species_id],
    );
    const speciesRow = speciesRows[0] ?? null;
    const traits = (owned[0].traits ?? {}) as PetTraits;

    return NextResponse.json({
      ok: true,
      customDescription: updated[0]?.custom_description ?? null,
      defaultDescription: speciesRow
        ? renderPetDescription(speciesRow, traits, locale)
        : null,
      restoredDefault: next === null,
    });
  } catch (err) {
    console.error("[pets/description] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(resolveLocale(req), "interactFailed") },
      { status: 500 },
    );
  }
}
