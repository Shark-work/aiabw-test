import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/onboarding — 新手引导「唤醒仪式」状态查询
 * 响应：{ ok, completed, hasPet, candidate }
 *  - completed：users.onboarding_completed（三步引导完成标记）；
 *  - hasPet：是否已持有灵宠（adoptions 非空）——存量老用户天然跳过引导与 banner；
 *  - candidate：仅未完成且无灵宠时返回一只随机「待唤醒」灵宠（沉睡展示 + 唤醒目标），
 *    可领养口径与 /api/pets/claim 一致（visible=true 且 owner/guest_owner 均为空）。
 *
 * POST /api/onboarding — 标记引导完成（幂等，重复调用结果一致）。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }
  try {
    await ensureDbSchemaOnce();
    const { rows: stateRows } = await pool.query(
      `SELECT u.onboarding_completed AS "completed",
              EXISTS(SELECT 1 FROM adoptions a WHERE a.user_id = u.id) AS "hasPet"
         FROM users u
        WHERE u.id = $1`,
      [user.id],
    );
    const completed = !!stateRows[0]?.completed;
    const hasPet = !!stateRows[0]?.hasPet;

    let candidate: Record<string, unknown> | null = null;
    if (!completed && !hasPet) {
      const { rows } = await pool.query(
        `SELECT p.id AS "petId", p.species_id AS "speciesId", p.image_url AS "imageUrl",
                p.traits, d.name_zh AS "nameZh", d.name_en AS "nameEn",
                d.category, d.habitat
           FROM pets p
           JOIN pet_dictionary d ON d.id = p.species_id
          WHERE p.visible = true AND p.owner_id IS NULL AND p.guest_owner IS NULL
          ORDER BY random()
          LIMIT 1`,
      );
      const row = rows[0];
      if (row) {
        const traits = (row.traits ?? {}) as Record<string, unknown>;
        candidate = {
          petId: String(row.petId),
          speciesId: String(row.speciesId),
          name: locale === "en" ? String(row.nameEn) : String(row.nameZh),
          category: String(row.category),
          habitat: row.habitat ? String(row.habitat) : null,
          imageUrl: row.imageUrl ? String(row.imageUrl) : null,
          rarity: typeof traits.rarity === "string" ? traits.rarity : "common",
          element: typeof traits.element === "string" ? traits.element : null,
        };
      }
    }

    return NextResponse.json({ ok: true, completed, hasPet, candidate });
  } catch (err) {
    console.error("[onboarding] status failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "onboardingFailed") },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }
  try {
    await ensureDbSchemaOnce();
    await pool.query(
      `UPDATE users SET onboarding_completed = true WHERE id = $1`,
      [user.id],
    );
    return NextResponse.json({ ok: true, completed: true });
  } catch (err) {
    console.error("[onboarding] complete failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "onboardingFailed") },
      { status: 500 },
    );
  }
}
