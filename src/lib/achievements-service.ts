/**
 * 探索成就 · 服务端聚合与解锁入账（roadmap 任务二，2026-09-23）
 * ------------------------------------------------------------
 * 职责：
 *  1) gatherAchievementStats：单条 SQL 聚合 8 徽章所需的全部源表统计
 *     （V2 探索记录 / 事件覆盖 / 百科物种 / 亲密度 / 连签 / V1 老数据折算）；
 *  2) syncAchievements：评估 → 对达成且未解锁的徽章做「事务化解锁 + 积分入账」
 *     （achievements 行 + users.points + points_log，UNIQUE 约束 + ON CONFLICT
 *     DO NOTHING 保证并发/重试幂等）→ 返回徽章列表与本次新解锁（庆祝动画数据源）；
 *  3) 迁移步骤 3 回归礼包：V1 老用户（COUNT(user_postcards) >= 1）首次检查时
 *     自动解锁「元老探险家」徽章（veteran-explorer，+20 积分，同事务入账，幂等）。
 *
 * 触发节点（roadmap：探索完成、登录、百科解锁等关键节点）：
 *  - POST /api/exploration/start：探索完成即时评估（庆祝动画即时反馈）；
 *  - GET  /api/achievements：面板加载惰性评估（覆盖签到/亲密度/百科等非探索节点）。
 */

import { eq, sql } from "drizzle-orm";

import { db, pool } from "@/db/client";
import { achievements, pointsLog, users } from "@/db/schema";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_MAP,
  COMMON_EVENT_ID_MAX,
  COMMON_EVENT_ID_MIN,
  RARE_EVENT_ID_MAX,
  RARE_EVENT_ID_MIN,
  VETERAN_BADGE,
  getBadgeProgress,
  isBadgeUnlocked,
  type AchievementStats,
  type BadgeId,
  type NewlyUnlockedBadge,
} from "@/lib/achievements-config";

export type BadgeState = {
  id: BadgeId;
  emoji: string;
  rewardPoints: number;
  target: number;
  /** 当前进度（clamped 0..target；master = 已解锁的非 master 徽章数） */
  progress: number;
  unlocked: boolean;
  unlockedAt: string | null;
};

export type SyncAchievementsResult = {
  badges: BadgeState[];
  unlockedCount: number;
  totalCount: number;
  newlyUnlocked: NewlyUnlockedBadge[];
};

type StatsRow = {
  v2_explorations: number;
  v1_postcards: number;
  v1_steps: number;
  common_events: number;
  rare_events: number;
  wiki_species: number;
  max_happiness: number;
  checkin_streak: number;
};


/**
 * 聚合统计（单 RTT）。
 * V1 老用户探索次数折算口径（roadmap §三 2026-09-23 代码核实）：
 *   V1 探索次数 = max(Σ adoptions.exploration_steps ÷ 100（每图 100 步）,
 *                     COUNT(user_postcards)（每完成一图一张）)
 *   累计探索次数 = V2 exploration_records 行数 + V1 折算值
 * （V1 事件触发无用户维度持久化 → 事件类徽章 V1 用户从 0 开始，见同节说明。）
 */
export async function gatherAchievementStats(
  userId: string,
): Promise<AchievementStats & { v1Postcards: number }> {
  const res = (await pool.query(
    // 注意（2026-09-23 实测 "operator does not exist: text = uuid"）：
    // 同一参数 $1 在多张子查询里要同时匹配 uuid 列与 text 列，PG 无法推断统一类型
    // → 显式分用：uuid 列用 $1::uuid；adoptions.user_id 是历史遗留 text 列
    //   （drizzle/0001，默认 'anonymous'）→ 用 $1::text（uuid 字符串可直接比较）。
    `SELECT
       (SELECT count(*)::int FROM exploration_records WHERE user_id = $1::uuid)
         AS v2_explorations,
       (SELECT count(*)::int FROM user_postcards WHERE user_id = $1::uuid)
         AS v1_postcards,
       (SELECT COALESCE(SUM(exploration_steps), 0)::int FROM adoptions
         WHERE user_id = $1::text) AS v1_steps,
       (SELECT count(DISTINCT event_id)::int FROM exploration_records
         WHERE user_id = $1::uuid
           AND event_id BETWEEN '${COMMON_EVENT_ID_MIN}' AND '${COMMON_EVENT_ID_MAX}')
         AS common_events,
       (SELECT count(DISTINCT event_id)::int FROM exploration_records
         WHERE user_id = $1::uuid
           AND event_id BETWEEN '${RARE_EVENT_ID_MIN}' AND '${RARE_EVENT_ID_MAX}')
         AS rare_events,
       (SELECT count(DISTINCT e.knowledge_link)::int
          FROM exploration_records r
          JOIN exploration_events e ON e.id = r.event_id
         WHERE r.user_id = $1::uuid AND e.knowledge_link IS NOT NULL) AS wiki_species,
       (SELECT COALESCE(MAX(happiness), 0)::int FROM adoptions
         WHERE user_id = $1::text) AS max_happiness,
       (SELECT COALESCE(checkin_streak, 0)::int FROM users WHERE id = $1::uuid)
         AS checkin_streak`,
    [userId],
  )) as { rows: StatsRow[] };
  const row = res.rows[0];
  const v1Legacy = row
    ? Math.max(Math.floor(row.v1_steps / 100), row.v1_postcards)
    : 0;
  return {
    totalExplorations: (row?.v2_explorations ?? 0) + v1Legacy,
    commonEventCount: row?.common_events ?? 0,
    rareEventCount: row?.rare_events ?? 0,
    wikiSpeciesCount: row?.wiki_species ?? 0,
    maxHappiness: row?.max_happiness ?? 0,
    checkinStreak: row?.checkin_streak ?? 0,
    unlockedBadgeCount: 0, // 由 syncAchievements 在评估 master 前填充
    v1Postcards: row?.v1_postcards ?? 0, // 迁移步骤 3：V1 老用户识别（回归礼包门槛 >= 1）
  };
}

/**
 * 事务化解锁一枚徽章：插入 achievements 行（冲突=已解锁→跳过），
 * 同事务入账积分（users.points += reward；points_log reason='achievement'）。
 * progress = 解锁时刻进度快照（常规徽章传 def.target；回归礼包传明信片数）。
 * 返回 true = 本次确实完成了新解锁（并发下仅一个请求拿到 true）。
 */
async function creditBadge(
  userId: string,
  def: { id: string; rewardPoints: number },
  progress: number,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(achievements)
      .values({ userId, badgeId: def.id, progress })
      .onConflictDoNothing()
      .returning({ id: achievements.id });
    if (inserted.length === 0) return false;
    if (def.rewardPoints > 0) {
      await tx
        .update(users)
        .set({ points: sql`${users.points} + ${def.rewardPoints}` })
        .where(eq(users.id, userId));
      await tx
        .insert(pointsLog)
        .values({ userId, amount: def.rewardPoints, reason: "achievement" });
    }
    return true;
  });
}

/**
 * 评估 + 解锁 + 返回全量徽章状态。
 * 顺序：先回归礼包（veteran，仅 V1 老用户）→ 7 枚非 master → 统计已解锁数 →
 * 再评估 master（艾比大师）。veteran 不占 8 枚常规位、不计入 master/面板计数。
 */
export async function syncAchievements(
  userId: string,
): Promise<SyncAchievementsResult> {
  const stats = await gatherAchievementStats(userId);
  const existing = await db
    .select({
      badgeId: achievements.badgeId,
      unlockedAt: achievements.unlockedAt,
    })
    .from(achievements)
    .where(eq(achievements.userId, userId));
  const unlockedMap = new Map<string, Date>(
    existing.map((r) => [r.badgeId, r.unlockedAt]),
  );

  const newlyUnlocked: NewlyUnlockedBadge[] = [];
  const nonMaster = ACHIEVEMENTS.filter((d) => d.id !== "master");

  // 0) 迁移步骤 3 回归礼包：V1 老用户（COUNT(user_postcards) >= 1，stats 已聚合）
  //    首次检查自动解锁「元老探险家」+ 20 积分；progress 记明信片数快照。
  //    已解锁短路 + UNIQUE(user_id,badge_id) 约束兜底 → 重复调用/并发幂等，不重复入账。
  //    探索次数类徽章（初出茅庐/探险新手）进度已由 gatherAchievementStats 按
  //    max(Σsteps÷100, COUNT(postcards)) 回填进 totalExplorations，下方循环自动达标。
  if (stats.v1Postcards >= 1 && !unlockedMap.has(VETERAN_BADGE.id)) {
    if (await creditBadge(userId, VETERAN_BADGE, stats.v1Postcards)) {
      newlyUnlocked.push({
        id: VETERAN_BADGE.id,
        emoji: VETERAN_BADGE.emoji,
        rewardPoints: VETERAN_BADGE.rewardPoints,
      });
    }
  }

  // 1) 非 master 徽章：按 roadmap 顺序评估
  for (const def of nonMaster) {
    if (unlockedMap.has(def.id)) continue;
    if (!isBadgeUnlocked(def.id, stats)) continue;
    if (await creditBadge(userId, def, def.target)) {
      unlockedMap.set(def.id, new Date());
      newlyUnlocked.push({
        id: def.id,
        emoji: def.emoji,
        rewardPoints: def.rewardPoints,
      });
    }
  }

  // 2) master（艾比大师）：其它 7 枚全部解锁后达成
  const nonMasterUnlocked = nonMaster.filter((d) =>
    unlockedMap.has(d.id),
  ).length;
  stats.unlockedBadgeCount = nonMasterUnlocked;
  const masterDef = ACHIEVEMENT_MAP.master;
  if (!unlockedMap.has("master") && nonMasterUnlocked >= masterDef.target) {
    if (await creditBadge(userId, masterDef, masterDef.target)) {
      unlockedMap.set("master", new Date());
      newlyUnlocked.push({
        id: "master",
        emoji: masterDef.emoji,
        rewardPoints: masterDef.rewardPoints,
      });
    }
  }

  // 3) 汇总输出（面板渲染数据源）
  const badges: BadgeState[] = ACHIEVEMENTS.map((def) => ({
    id: def.id,
    emoji: def.emoji,
    rewardPoints: def.rewardPoints,
    target: def.target,
    progress:
      def.id === "master"
        ? Math.min(nonMasterUnlocked, def.target)
        : getBadgeProgress(def.id, stats),
    unlocked: unlockedMap.has(def.id),
    unlockedAt: unlockedMap.get(def.id)?.toISOString() ?? null,
  }));
  return {
    badges,
    unlockedCount: badges.filter((b) => b.unlocked).length,
    totalCount: ACHIEVEMENTS.length,
    newlyUnlocked,
  };
}
