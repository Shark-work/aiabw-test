import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import {
  petPower,
  startOfWeek,
  periodStart,
  LEADERBOARD_LIMIT,
  LEADERBOARD_CATEGORIES,
  LEADERBOARD_PERIODS,
  type LeaderboardCategory,
  type LeaderboardPeriod,
} from "@/lib/leaderboard";
import { loadActivePromotions } from "@/lib/promotions";
import { redactSensitive, toPublicOwner } from "@/lib/privacy";

export const runtime = "nodejs";

/**
 * GET /api/leaderboard?type=pets|breeders
 *  - type=pets：全服最强宠物榜 Top 20（user_collectibles 综合战力分：稀有度×代数 + 元素）
 *  - type=breeders：本周结晶达人榜 Top 20（本周共鸣结晶新藏品最多的用户）
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

    // Phase 5：多维榜单（category 参数优先；无 category 时走旧 type 路径，向后兼容 pets 页 Tab / verify-growth）
    const categoryRaw = url.searchParams.get("category");
    if (categoryRaw && (LEADERBOARD_CATEGORIES as readonly string[]).includes(categoryRaw)) {
      return await handleCategoryBoard(req, locale, anonName, categoryRaw as LeaderboardCategory, url);
    }

    if (type === "breeders") {
      // 本周结晶达人：本周（本周一 00:00 起）共鸣结晶新藏品最多的用户（排除 opt-out）
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
    const ranked = await queryRankedPets(locale, anonName);
    const items = ranked.slice(0, LEADERBOARD_LIMIT).map((item, i) => ({ ...item, rank: i + 1 }));

    return NextResponse.json({ ok: true, type: "pets", items });
  } catch (err) {
    console.error("[leaderboard] failed:", redactSensitive(err instanceof Error ? err.message : String(err)));
    return NextResponse.json({ ok: false, error: "leaderboard_failed" }, { status: 500 });
  }
}

// ===== 产品升级 Phase 5：多维榜单 =====

type PetRankItem = {
  rank: number;
  id: string;
  collectibleId: string;
  hashId: string;
  ownerId: string;
  ownerName: string;
  name: string;
  rarity: string;
  element: string | null;
  generation: number;
  power: number;
  imageUrl: string;
};

/** 全服战力候选（active + 主人未 opt-out）→ JS 精确战力 → 降序全量（rank=0，调用方切片后赋名次）。 */
async function queryRankedPets(locale: string, anonName: string): Promise<PetRankItem[]> {
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
  return rows
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
    .sort((a, b) => b.power - a.power || b.generation - a.generation);
}

/** count 类榜（收藏/探索/创作）数据源映射：from 带别名，join 到 users 取公开昵称 + opt-out 过滤 */
const COUNT_BOARDS: Record<
  Exclude<LeaderboardCategory, "popularity">,
  { from: string; join: string; userCol: string; timeCol: string; extra: string }
> = {
  collection: {
    from: "user_collectibles uc",
    join: "JOIN users u ON u.id = uc.owner_id",
    userCol: "uc.owner_id",
    timeCol: "uc.minted_at",
    extra: "AND uc.status = 'active'",
  },
  exploration: {
    from: "exploration_records er",
    join: "JOIN users u ON u.id = er.user_id",
    userCol: "er.user_id",
    timeCol: "er.created_at",
    extra: "",
  },
  creation: {
    from: "ugc_creations ug",
    join: "JOIN users u ON u.id = ug.user_id",
    userCol: "ug.user_id",
    timeCol: "ug.created_at",
    extra: "",
  },
};

/**
 * Phase 5 多维榜单：?category=popularity|collection|exploration|creation&period=day|week|month|all
 *  - popularity（人气 = 综合战力）为累计口径无时间窗（period 固定回显 all）；
 *  - 其余三类按 period 窗口统计计数；
 *  - 登录用户附 myRank（未登录为 null，不影响榜单）；
 *  - 响应附 promoted（付费推荐位坑位；返回即累计一次曝光）。
 */
async function handleCategoryBoard(
  req: Request,
  locale: string,
  anonName: string,
  category: LeaderboardCategory,
  url: URL,
) {
  const periodRaw = url.searchParams.get("period") ?? "week";
  const period: LeaderboardPeriod = (LEADERBOARD_PERIODS as readonly string[]).includes(periodRaw)
    ? (periodRaw as LeaderboardPeriod)
    : "week";
  const user = await getUserFromRequest(req).catch(() => null);

  let items: unknown[];
  let myRank: { rank: number; value: number; name?: string } | null = null;
  let effectivePeriod: LeaderboardPeriod = period;
  const since = periodStart(period);

  if (category === "popularity") {
    effectivePeriod = "all";
    const ranked = await queryRankedPets(locale, anonName);
    if (user) {
      const idx = ranked.findIndex((r) => r.ownerId === user.id);
      if (idx >= 0) myRank = { rank: idx + 1, value: ranked[idx].power, name: ranked[idx].name };
    }
    items = ranked.slice(0, LEADERBOARD_LIMIT).map((it, i) => ({ ...it, rank: i + 1 }));
  } else {
    const cfg = COUNT_BOARDS[category];
    const { rows } = await pool.query(
      `SELECT ${cfg.userCol} AS "ownerId", u.username AS owner_name, count(*)::int AS cnt
         FROM ${cfg.from}
         ${cfg.join}
        WHERE u.show_in_leaderboard = true ${cfg.extra}
          AND ($1::timestamp IS NULL OR ${cfg.timeCol} >= $1)
        GROUP BY ${cfg.userCol}, u.username
        ORDER BY cnt DESC
        LIMIT $2`,
      [since, LEADERBOARD_LIMIT],
    );
    items = rows.map((r, i) => ({
      rank: i + 1,
      ...toPublicOwner({ ownerId: String(r.ownerId), username: r.owner_name }, anonName),
      count: Number(r.cnt),
    }));
    if (user) {
      const mine = await pool.query(
        `SELECT count(*)::int AS cnt FROM ${cfg.from}
          WHERE ${cfg.userCol} = $1::uuid ${cfg.extra}
            AND ($2::timestamp IS NULL OR ${cfg.timeCol} >= $2)`,
        [user.id, since],
      );
      const myCount = Number(mine.rows[0]?.cnt ?? 0);
      if (myCount > 0) {
        const higher = await pool.query(
          `SELECT count(*)::int AS n FROM (
             SELECT ${cfg.userCol}
               FROM ${cfg.from}
               ${cfg.join}
              WHERE u.show_in_leaderboard = true ${cfg.extra}
                AND ($1::timestamp IS NULL OR ${cfg.timeCol} >= $1)
              GROUP BY ${cfg.userCol}
             HAVING count(*) > $2
           ) t`,
          [since, myCount],
        );
        myRank = { rank: Number(higher.rows[0]?.n ?? 0) + 1, value: myCount };
      }
    }
  }

  const promoted = await loadActivePromotions(locale, anonName, { countView: true });

  return NextResponse.json({
    ok: true,
    category,
    period: effectivePeriod,
    periodStart: effectivePeriod === "all" ? null : (since?.toISOString() ?? null),
    items,
    myRank,
    promoted,
  });
}

