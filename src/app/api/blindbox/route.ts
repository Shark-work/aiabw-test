import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/blindbox — 盲盒奖池列表（含爆率公示 probabilities，合规展示用）
 * 返回激活奖池：id / 名称 / 价格 / 概率分布（供前端「爆率公示」弹窗）。
 * 登录用户额外返回 todayClaimed（每日福利箱今日是否已领取，前端置灰按钮）。
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

    // 登录用户：今日每日福利箱是否已领取（复用 blindbox_logs.created_at）
    let dailyClaimedToday = false;
    try {
      const user = await getUserFromRequest(req);
      if (user) {
        const r = await pool.query(
          `SELECT 1 FROM blindbox_logs
            WHERE user_id = $1 AND pool_id = 'newbie_welcome'
              AND created_at::date = CURRENT_DATE
            LIMIT 1`,
          [user.id],
        );
        dailyClaimedToday = r.rows.length > 0;
      }
    } catch {
      // 未登录/解析失败：不返回今日状态
    }

    const pools = rows.map((r) => ({
      id: String(r.id),
      name: locale === "en" ? String(r.nameEn) : String(r.nameZh),
      priceCny: String(r.priceCny),
      pricePoints: Number(r.pricePoints),
      probabilities: r.probabilities ?? {},
      todayClaimed: String(r.id) === "newbie_welcome" ? dailyClaimedToday : false,
    }));
    return NextResponse.json({ ok: true, pools });
  } catch (err) {
    console.error("[blindbox] failed:", err);
    return NextResponse.json({ ok: false, error: "blindbox_failed" }, { status: 500 });
  }
}
