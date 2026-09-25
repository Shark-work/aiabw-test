/**
 * 探索成就系统 · 徽章定义与评估器（roadmap 任务二，2026-09-23）
 * ------------------------------------------------------------
 * 纯函数、零依赖（前后端共用；服务端聚合统计见 achievements-service.ts）。
 *
 * 设计要点：
 *  - 8 枚徽章（roadmap §二规格）：进度全部由源表实时推导，不设冗余进度表
 *    （exploration_records / knowledge_link / users.checkin_streak /
 *      adoptions.happiness / V1 口径 max(Σsteps÷100, postcards)）；
 *  - 「亲密无间」数据源核实：代码无独立 intimacy 字段 → adoptions.happiness（0-100，
 *    /api/interact 维护）满值 100 视为「亲密度满级」；
 *  - 「百科达人」target=5：wiki 已达 5 物种（persian-cat/red-fox/shiba-inu +
 *    任务一新增 lop-rabbit/cockatiel），解锁条件可达；
 *  - 「艾比大师」：其它 7 枚全部解锁后达成（target=7 = 非 master 徽章数）。
 */

export type BadgeId =
  | "first-explore" // 初出茅庐：完成首次探索
  | "explorer-10" // 探险新手：累计探索 10 次
  | "all-common-events" // 足迹遍布：触发全部普通事件 evt-001~020
  | "all-rare-events" // 奇遇猎人：触发全部稀有事件 evt-021~040
  | "wiki-collector" // 百科达人：解锁 5 种宠物百科
  | "bond-max" // 亲密无间：任意宠物亲密度（happiness）满值
  | "checkin-7" // 全勤奖：连续签到 7 天
  | "master"; // 艾比大师：解锁其它全部徽章

export type AchievementDef = {
  id: BadgeId;
  emoji: string;
  /** 解锁奖励积分（解锁时一次性入账 users.points + points_log） */
  rewardPoints: number;
  /** 达成目标值（进度达到即解锁） */
  target: number;
  /** 展示顺序（1-based，按 roadmap 表格顺序） */
  order: number;
};

/** 普通事件 ID 区间（足迹遍布统计范围，零填充文本可直接 BETWEEN 比较） */
export const COMMON_EVENT_ID_MIN = "evt-001";
export const COMMON_EVENT_ID_MAX = "evt-020";
/** 稀有事件 ID 区间（奇遇猎人统计范围） */
export const RARE_EVENT_ID_MIN = "evt-021";
export const RARE_EVENT_ID_MAX = "evt-040";
/** 亲密无间目标：happiness 上限（/api/interact clamp 0-100） */
export const HAPPINESS_MAX = 100;
/** 艾比大师目标：非 master 徽章总数 */
export const MASTER_TARGET = 7;

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: "first-explore", emoji: "🌱", rewardPoints: 5, target: 1, order: 1 },
  { id: "explorer-10", emoji: "🧭", rewardPoints: 10, target: 10, order: 2 },
  { id: "all-common-events", emoji: "🗺️", rewardPoints: 20, target: 20, order: 3 },
  { id: "all-rare-events", emoji: "✨", rewardPoints: 30, target: 20, order: 4 },
  { id: "wiki-collector", emoji: "📚", rewardPoints: 15, target: 5, order: 5 },
  { id: "bond-max", emoji: "💞", rewardPoints: 25, target: HAPPINESS_MAX, order: 6 },
  { id: "checkin-7", emoji: "📅", rewardPoints: 35, target: 7, order: 7 },
  { id: "master", emoji: "👑", rewardPoints: 100, target: MASTER_TARGET, order: 8 },
];

export const ACHIEVEMENT_MAP: Readonly<Record<BadgeId, AchievementDef>> =
  Object.fromEntries(ACHIEVEMENTS.map((d) => [d.id, d])) as Record<
    BadgeId,
    AchievementDef
  >;

/** 徽章 id → i18n key（messages/*.json achievements.badges.<key>.name|desc|rewardNote） */
export const BADGE_I18N_KEYS: Readonly<Record<BadgeId, string>> = {
  "first-explore": "firstExplore",
  "explorer-10": "explorer10",
  "all-common-events": "allCommonEvents",
  "all-rare-events": "allRareEvents",
  "wiki-collector": "wikiCollector",
  "bond-max": "bondMax",
  "checkin-7": "checkin7",
  master: "master",
};

/** 除积分外附带特殊奖励的徽章（UI 展示 rewardNote：宠物解锁资格/称号/头像框） */
export const REWARD_NOTE_BADGES: ReadonlySet<BadgeId> = new Set<BadgeId>([
  "explorer-10", // 垂耳兔解锁资格
  "all-rare-events", // 玄凤鹦鹉解锁资格
  "bond-max", // 专属称号
  "master", // 限定头像框
]);

/** 新解锁徽章（API 响应用，前端庆祝动画数据源） */
export type NewlyUnlockedBadge = {
  id: BadgeId;
  emoji: string;
  rewardPoints: number;
};

/**
 * 徽章进度统计输入（由 achievements-service 聚合；V1 老用户数据已折算进
 * totalExplorations：V2 记录数 + max(Σ adoptions.exploration_steps ÷ 100,
 * COUNT(user_postcards))，见 roadmap §三数据兼容要点）。
 */
export type AchievementStats = {
  /** 累计探索次数（V2 记录 + V1 折算） */
  totalExplorations: number;
  /** 已触发普通事件种数（distinct event_id ∈ evt-001~020） */
  commonEventCount: number;
  /** 已触发稀有事件种数（distinct event_id ∈ evt-021~040） */
  rareEventCount: number;
  /** 已解锁百科物种数（distinct knowledge_link） */
  wikiSpeciesCount: number;
  /** 所有宠物中最高亲密度（adoptions.happiness，0-100） */
  maxHappiness: number;
  /** 当前连续签到天数（users.checkin_streak） */
  checkinStreak: number;
  /** 已解锁的非 master 徽章数（master 评估用） */
  unlockedBadgeCount: number;
};

/** 计算某徽章当前进度（clamped 0..target）。 */
export function getBadgeProgress(id: BadgeId, stats: AchievementStats): number {
  const def = ACHIEVEMENT_MAP[id];
  const raw =
    id === "first-explore" || id === "explorer-10"
      ? stats.totalExplorations
      : id === "all-common-events"
        ? stats.commonEventCount
        : id === "all-rare-events"
          ? stats.rareEventCount
          : id === "wiki-collector"
            ? stats.wikiSpeciesCount
            : id === "bond-max"
              ? stats.maxHappiness
              : id === "checkin-7"
                ? stats.checkinStreak
                : stats.unlockedBadgeCount; // master
  return Math.max(0, Math.min(def.target, Math.floor(raw)));
}

/** 判定徽章是否已达成（progress >= target）。 */
export function isBadgeUnlocked(id: BadgeId, stats: AchievementStats): boolean {
  return getBadgeProgress(id, stats) >= ACHIEVEMENT_MAP[id].target;
}
