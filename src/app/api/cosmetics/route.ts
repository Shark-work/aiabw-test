import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/cosmetics?adoptionId=<uuid>
 * 返回装扮商品列表（皮肤/特效，人民币购买）+ 当前用户对指定宠物的已购状态。
 *  - owned: 该装扮是否已购买（全局 or 绑定该宠物）
 *  - 未登录用户 owned 恒为 false（前端展示锁定状态）
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  try {
    await ensureDbSchemaOnce();
    const url = new URL(req.url);
    const adoptionId = url.searchParams.get("adoptionId")?.trim() || "";
    // 空 adoptionId → null（避免 $2::uuid cast 空串报错）
    const adoptionIdParam = adoptionId || null;

    const { rows } = await pool.query(
      `SELECT id, name_zh AS "nameZh", name_en AS "nameEn", kind, image_url AS "imageUrl",
              price_cny AS "priceCny", is_visible AS "isVisible"
         FROM cosmetics
        WHERE is_visible = true
        ORDER BY kind, price_cny`,
    );

    // 当前用户已购集合（全局 or 绑定该宠物）
    const owned = new Set<string>();
    const user = await getUserFromRequest(req);
    if (user) {
      const { rows: held } = await pool.query(
        `SELECT cosmetic_id
           FROM user_cosmetics
          WHERE user_id = $1 AND status = 'active'
            AND (adoption_id IS NULL OR adoption_id = $2::uuid)`,
        [user.id, adoptionIdParam],
      );
      for (const r of held) owned.add(String(r.cosmetic_id));
    }

    const items = rows.map((r) => ({
      id: String(r.id),
      name: locale === "en" ? String(r.nameEn) : String(r.nameZh),
      kind: String(r.kind),
      imageUrl: r.imageUrl ? String(r.imageUrl) : null,
      priceCny: String(r.priceCny),
      owned: owned.has(String(r.id)),
    }));

    return NextResponse.json({ ok: true, items });
  } catch (err) {
    console.error("[cosmetics] failed:", err);
    return NextResponse.json({ ok: false, error: "cosmetics_failed" }, { status: 500 });
  }
}
