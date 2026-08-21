import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * POST /api/pets/release
 * 请求体：{ petIds: string[] }
 * 放生/删除宠物（软删除：status='consumed'，不再出现在我的宠物列表）。
 * 仅限当前用户拥有的 active 宠物；事务内原子更新。
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const petIds = Array.isArray(body?.petIds)
      ? body.petIds.filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
      : [];
    if (!petIds.length) {
      return NextResponse.json({ ok: false, error: apiError(locale, "invalidEvolveSet") }, { status: 400 });
    }

    const { rows } = await pool.query(
      `UPDATE pets SET status = 'consumed'
        WHERE id = ANY($1) AND owner_id = $2 AND status = 'active'
        RETURNING id`,
      [petIds, user.id],
    );

    return NextResponse.json({ ok: true, released: rows.length });
  } catch (err) {
    console.error("[pets/release] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(locale, "releaseFailed") }, { status: 500 });
  }
}
