import { eq } from "drizzle-orm";

import { db, pool } from "@/db/client";
import { achievements, users } from "@/db/schema";
import { deserializeResultData } from "@/lib/exploration-engine";
import {
  POSTCARD_BADGE_PREFIX,
  POSTCARD_SET_REWARD_POINTS,
  postcardSetBadgeId,
} from "@/lib/postcard-config";

/**
 * 明信片墙公开数据查询（P2 社交传播 · 改动二）
 *
 * 与 /api/exploration/postcard-wall（本人视角，含领取）同口径的只读组装，
 * 供三处公开面复用：/api/postcard-wall/[userId]、/postcard-wall/[userId] 公开页、
 * /api/postcard-wall/[userId]/share.png 汇总分享图。
 *
 * 隐私门：目标用户不存在或未开启 postcard_wall_public → 返回 null
 * （调用方一律 404/notFound，不泄露开关状态）。
 */

export type PublicPostcard = {
  id: string;
  eventId: string | null;
  category: string | null;
  title: string;
  description: string;
  emoji: string;
  rarity: string;
  isRare: boolean;
  createdAt: string;
};

export type PublicCollection = {
  category: string;
  total: number;
  owned: number;
  complete: boolean;
  claimed: boolean;
  rewardPoints: number;
};

export type PublicPostcardWall = {
  owner: { id: string; username: string };
  cards: PublicPostcard[];
  collections: PublicCollection[];
};

export async function getPublicPostcardWall(
  userId: string,
): Promise<PublicPostcardWall | null> {
  const [owner] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .catch(() => []);
  // 隐私门单独查（postcard_wall_public 新列；异常/未开一律 null）
  const { rows: flagRows } = await pool.query(
    `SELECT postcard_wall_public AS pub FROM users WHERE id = $1::uuid LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] as { pub: boolean }[] }));
  if (!owner || !flagRows[0]?.pub) return null;

  const [cardsRes, setsRes, claimedRes] = await Promise.all([
    pool.query(
      `SELECT r.id, r.event_id AS "eventId", e.pet_category AS category,
              r.result_data AS "resultData", r.is_rare AS "isRare",
              r.created_at AS "createdAt"
         FROM exploration_records r
         LEFT JOIN exploration_events e ON e.id = r.event_id
        WHERE r.user_id = $1::uuid AND r.result_type = 'postcard'
        ORDER BY r.created_at DESC
        LIMIT 200`,
      [userId],
    ),
    pool.query(
      `SELECT e.pet_category AS category, count(*)::int AS total
         FROM exploration_events e
        WHERE e.event_type = 'postcard'
        GROUP BY e.pet_category`,
    ),
    db
      .select({ badgeId: achievements.badgeId })
      .from(achievements)
      .where(eq(achievements.userId, userId)),
  ]);

  const cards: PublicPostcard[] = cardsRes.rows.map((r) => {
    const meta = deserializeResultData(r.resultData);
    return {
      id: String(r.id),
      eventId: r.eventId ? String(r.eventId) : null,
      category: r.category ? String(r.category) : null,
      title: meta.title,
      description: meta.description,
      emoji: meta.emoji ?? "💌",
      rarity: meta.rarity,
      isRare: !!r.isRare,
      createdAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    };
  });

  const claimed = new Set(
    claimedRes.map((r) => r.badgeId).filter((b) => b.startsWith(POSTCARD_BADGE_PREFIX)),
  );
  const eventsByCategory = new Map<string, Set<string>>();
  for (const row of cardsRes.rows) {
    if (!row.category || !row.eventId) continue;
    const cat = String(row.category);
    if (!eventsByCategory.has(cat)) eventsByCategory.set(cat, new Set());
    eventsByCategory.get(cat)!.add(String(row.eventId));
  }

  const collections: PublicCollection[] = setsRes.rows.map((s) => {
    const category = String(s.category);
    const total = Number(s.total);
    const owned = eventsByCategory.get(category)?.size ?? 0;
    return {
      category,
      total,
      owned,
      complete: owned >= total && total > 0,
      claimed: claimed.has(postcardSetBadgeId(category)),
      rewardPoints: POSTCARD_SET_REWARD_POINTS,
    };
  });

  return { owner: { id: owner.id, username: owner.username }, cards, collections };
}
