import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { resolveLocale } from "@/i18n/api-errors";
import { petPower, startOfWeek, LEADERBOARD_LIMIT } from "@/lib/leaderboard";
import { redactSensitive, toPublicOwner } from "@/lib/privacy";

export const runtime = "nodejs";

/**
 * GET /api/leaderboard?type=pets|breeders
 *  - type=pets：全服最强宠物榜 Top 20（user_collectibles 综合战力分：稀有度×代数 + 元素）
 *  - type=breeders：本周繁育达人榜 Top 20（本周 minted 新藏品最多的用户）
 * 隐私约定：
 *  - DTO 只返回 ownerId + ownerName（公开昵称）+ 数值；绝不返回邮箱/手机号/IP/注册时间；
 *  - users.show_in_leaderboard = false 的用户（设置页 opt-out）不出现在任何榜单。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const anonName = locale === "en" ? "Anonymous" : "匿名用户";
  try {
    await ensureDbSchemaOnce();
    const url = new URL(req.url);
    const type = url.searchParams.get("type") ?? "pets";

    if (type === "breeders") {
      // 本周繁育达人：本周（本周一 00:00 起）铸造新藏品最多的用户（排除 opt-out）
      const weekStart = startOfWeek();
      const { rows } = await pool.query(
        `SELECT uc.owner_id AS "ownerId", u.username AS owner_name,
                count(*)::int AS minted_count
           FROM user_collectibles uc
           JOIN users u ON u.id = uc.owner_id
          WHERE uc.minted_at >= $1 AND uc.status = 'active'
            AND u.show_in_leaderboard = true
          GROUP BY uc.owner_id, u.username
          ORDER BY minted_count DESC
          LIMIT $2`,
        [weekStart, LEADERBOARD_LIMIT],
      );
      return NextResponse.json({
        ok: true,
        type: "breeders",
        weekStart: weekStart.toISOString(),
        items: rows.map((r, i) => ({
          rank: i + 1,
          ...toPublicOwner({ ownerId: String(r.ownerId), username: r.owner_name }, anonName),
          mintedCount: Number(r.minted_count),
        })),
      });
    }

    // 全服最强宠物榜：取候选（active + 主人未 opt-out）→ JS 精确计算战力分 → 排序取 Top 20
    const { rows } = await pool.query(
      `SELECT uc.id, uc.generation, uc.hash_id, uc.owner_id AS "ownerId",
              u.username AS owner_name,
              dc.id AS "collectibleId", dc.name_zh AS "nameZh", dc.name_en AS "nameEn",
              dc.rarity, dc.element, dc.base_image_url AS "imageUrl"
         FROM user_collectibles uc
         JOIN users u ON u.id = uc.owner_id
         JOIN digital_collectibles dc ON dc.id = uc.collectible_id
        WHERE uc.status = 'active'
          AND u.show_in_leaderboard = true
        ORDER BY uc.generation DESC, dc.rarity DESC
        LIMIT 500`,
    );
    const items = rows
      .map((r) => {
        const generation = Number(r.generation ?? 1);
        const power = petPower(generation, r.rarity, r.element);
        return {
          rank: 0,
          id: String(r.id),
          collectibleId: String(r.collectibleId),
          hashId: String(r.hash_id),
          ...toPublicOwner({ ownerId: String(r.ownerId), username: r.owner_name }, anonName),
          name: locale === "en" ? String(r.nameEn) : String(r.nameZh),
          rarity: String(r.rarity ?? "common"),
          element: r.element ? String(r.element) : null,
          generation,
          power,
          imageUrl: String(r.imageUrl ?? ""),
        };
      })
      .sort((a, b) => b.power - a.power || b.generation - a.generation)
      .slice(0, LEADERBOARD_LIMIT)
      .map((item, i) => ({ ...item, rank: i + 1 }));

    return NextResponse.json({ ok: true, type: "pets", items });
  } catch (err) {
    console.error("[leaderboard] failed:", redactSensitive(err instanceof Error ? err.message : String(err)));
    return NextResponse.json({ ok: false, error: "leaderboard_failed" }, { status: 500 });
  }
}
