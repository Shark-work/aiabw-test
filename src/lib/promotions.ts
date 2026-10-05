// 付费推荐位（产品升级 Phase 5）：promoted_content 生效窗口查询共享层。
// 排行榜增强 API 与 GET /api/content/promoted 共用，保证两处展示口径一致。
import { pool } from "@/db/client";
import { PROMOTE_CONTENT_TYPE, PROMOTED_SLOT_LIMIT } from "@/lib/leaderboard";
import { toPublicOwner } from "@/lib/privacy";

export type ActivePromotion = {
  id: string;
  contentId: string;
  priority: number;
  views: number;
  startTime: string;
  endTime: string;
  generation: number;
  hashId: string;
  name: string;
  rarity: string;
  element: string | null;
  imageUrl: string;
  ownerId: string;
  ownerName: string;
};

type PromotionRow = {
  id: string;
  contentId: string;
  priority: number;
  views: number;
  startTime: Date;
  endTime: Date;
  generation: number;
  hashId: string;
  nameZh: string;
  nameEn: string;
  rarity: string | null;
  element: string | null;
  imageUrl: string | null;
  ownerId: string | null;
  owner_name: string | null;
};

const BASE_SELECT = `
  SELECT pc.id, pc.content_id AS "contentId", pc.priority, pc.views,
         pc.start_time AS "startTime", pc.end_time AS "endTime",
         c.generation, c.hash_id AS "hashId",
         dc.name_zh AS "nameZh", dc.name_en AS "nameEn", dc.rarity, dc.element,
         dc.base_image_url AS "imageUrl",
         pc.promoter_id AS "ownerId", pu.username AS owner_name
    FROM promoted_content pc
    JOIN user_collectibles c ON c.id = pc.content_id
    JOIN digital_collectibles dc ON dc.id = c.collectible_id
    LEFT JOIN users pu ON pu.id = pc.promoter_id`;

function toDto(r: PromotionRow, locale: string, anonName: string): ActivePromotion {
  return {
    id: String(r.id),
    contentId: String(r.contentId),
    priority: Number(r.priority),
    views: Number(r.views),
    startTime: new Date(r.startTime).toISOString(),
    endTime: new Date(r.endTime).toISOString(),
    generation: Number(r.generation ?? 1),
    hashId: String(r.hashId),
    name: locale === "en" ? String(r.nameEn) : String(r.nameZh),
    rarity: String(r.rarity ?? "common"),
    element: r.element ? String(r.element) : null,
    imageUrl: String(r.imageUrl ?? ""),
    ...toPublicOwner({ ownerId: String(r.ownerId ?? ""), username: r.owner_name }, anonName),
  };
}

/**
 * 当前生效的推荐位（start_time ≤ now < end_time），priority 降序，取前 N 坑位。
 * countView=true 时（对外展示场景）同步 views+1 累计曝光；返回 DTO 的 views 为 +1 后口径。
 */
export async function loadActivePromotions(
  locale: string,
  anonName: string,
  opts: { countView?: boolean; limit?: number } = {},
): Promise<ActivePromotion[]> {
  const limit = opts.limit ?? PROMOTED_SLOT_LIMIT;
  const { rows } = await pool.query<PromotionRow>(
    `${BASE_SELECT}
      WHERE pc.content_type = $1
        AND pc.start_time <= now() AND pc.end_time > now()
      ORDER BY pc.priority DESC, pc.created_at ASC
      LIMIT $2`,
    [PROMOTE_CONTENT_TYPE, limit],
  );
  if (opts.countView && rows.length > 0) {
    const ids = rows.map((r) => String(r.id));
    // 曝光累计失败不阻塞展示（降级为少记一次曝光）
    try {
      await pool.query(`UPDATE promoted_content SET views = views + 1 WHERE id = ANY($1::uuid[])`, [ids]);
    } catch (err) {
      console.error("[promotions] views incr failed:", err instanceof Error ? err.message : String(err));
    }
    return rows.map((r) => toDto({ ...r, views: Number(r.views) + 1 }, locale, anonName));
  }
  return rows.map((r) => toDto(r, locale, anonName));
}

/** 我的推广记录（含已过期），按创建时间倒序。 */
export async function loadMyPromotions(
  userId: string,
  locale: string,
  anonName: string,
): Promise<ActivePromotion[]> {
  const { rows } = await pool.query<PromotionRow>(
    `${BASE_SELECT}
      WHERE pc.promoter_id = $1::uuid
      ORDER BY pc.created_at DESC
      LIMIT 20`,
    [userId],
  );
  return rows.map((r) => toDto(r, locale, anonName));
}
