import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/** 灵宠名长度上限（与灵魂卡 mint 名长约束一致：最长 24 字符）。 */
const PET_NAME_MAX = 24;

/**
 * POST /api/onboarding/name — 新手引导 Step 3「启程」：给灵宠起名
 * 请求体：{ adoptionId, petId, name }
 *  - UPDATE adoptions SET pet_name（归属校验在行内：id + user_id，不匹配 → 404）；
 *  - 同步 soul_cards.name（唤醒即铸卡后卡面名与灵宠名保持一致；该灵宠无卡时静默跳过）；
 *  - name 去除首尾空白，长度 1-24；
 *  - 幂等：同名重复提交结果一致（纯 UPDATE，无副作用）。
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const adoptionId =
    typeof body?.adoptionId === "string" ? body.adoptionId.trim() : "";
  const petId = typeof body?.petId === "string" ? body.petId.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!adoptionId || !petId) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "adoptionNotFound") },
      { status: 404 },
    );
  }
  if (name.length < 1 || name.length > PET_NAME_MAX) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "petNameInvalid") },
      { status: 400 },
    );
  }

  try {
    await ensureDbSchemaOnce();
    const { rowCount } = await pool.query(
      `UPDATE adoptions SET pet_name = $3 WHERE id = $1 AND user_id = $2`,
      [adoptionId, user.id, name],
    );
    if (!rowCount) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "adoptionNotFound") },
        { status: 404 },
      );
    }
    // 灵魂卡名同步（唤醒即铸卡：卡面名 = 灵宠名；无卡时 0 行静默跳过）
    await pool.query(
      `UPDATE soul_cards SET name = $3, updated_at = now()
        WHERE pet_id = $1 AND owner_id = $2`,
      [petId, user.id, name],
    );
    return NextResponse.json({ ok: true, name });
  } catch (err) {
    console.error("[onboarding/name] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "onboardingFailed") },
      { status: 500 },
    );
  }
}
