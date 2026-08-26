import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/blindbox — 盲盒奖池列表（含爆率公示 probabilities，合规展示用）
 * 返回激活奖池：id / 名称 / 价格 / 概率分布（供前端「爆率公示」弹窗）。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  try {
    await ensureDbSchemaOnce();
    const { rows } = await pool.query(
      `SELECT id, name_zh AS "nameZh", name_en AS "nameEn",
              price_cny AS "priceCny", price_points AS "pricePoints",
              probabilities, species_ids AS "speciesIds", is_active AS "isActive"
         FROM blindbox_pools
        WHERE is_active = true
        ORDER BY created_at`,
    );
    const pools = rows.map((r) => ({
      id: String(r.id),
      name: locale === "en" ? String(r.nameEn) : String(r.nameZh),
      priceCny: String(r.priceCny),
      pricePoints: Number(r.pricePoints),
      probabilities: r.probabilities ?? {},
    }));
    return NextResponse.json({ ok: true, pools });
  } catch (err) {
    console.error("[blindbox] failed:", err);
    return NextResponse.json({ ok: false, error: "blindbox_failed" }, { status: 500 });
  }
}
