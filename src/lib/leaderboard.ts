// 宠物排行榜 - 战力分计算（纯函数，无 DB / 无 Next 依赖，便于单元测试）。
// 战力分 = 稀有度权重 × 10^(代数-1) + 元素加成
// 稀有度权重：common 10 / uncommon 30 / rare 100 / epic 300 / legendary 1000
// 元素加成：fire 5 / water 4 / earth 3 / air 2（未知名 0）

export const RARITY_POWER: Record<string, number> = {
  common: 10,
  uncommon: 30,
  rare: 100,
  epic: 300,
  legendary: 1000,
};

export const ELEMENT_BONUS: Record<string, number> = {
  fire: 5,
  water: 4,
  earth: 3,
  air: 2,
};

/** 计算单只宠物的综合战力分。 */
export function petPower(generation: number, rarity?: string | null, element?: string | null): number {
  const rw = RARITY_POWER[rarity ?? ""] ?? 10;
  const gen = Math.max(0, Math.floor(Number(generation) || 1) - 1);
  return rw * Math.pow(10, gen) + (ELEMENT_BONUS[element ?? ""] ?? 0);
}

/** 返回本周一 00:00（本地时区），用于「本周结晶达人榜」统计窗口。 */
export function startOfWeek(now: Date = new Date()): Date {
  const d = new Date(now);
  const day = d.getDay() === 0 ? 7 : d.getDay(); // 周日=7
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (day - 1));
  return d;
}

/** 排行榜默认展示数量 */
export const LEADERBOARD_LIMIT = 20;

// ===== 产品升级 Phase 5：多维榜单 + 付费推荐位 =====

/** 榜单分类：人气（战力）/ 收藏 / 探索 / 创作 */
export const LEADERBOARD_CATEGORIES = ["popularity", "collection", "exploration", "creation"] as const;
export type LeaderboardCategory = (typeof LEADERBOARD_CATEGORIES)[number];

/** 统计周期：日 / 周 / 月 / 总 */
export const LEADERBOARD_PERIODS = ["day", "week", "month", "all"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

/** 周期窗口起点（本地时区）；all 返回 null 表示不限时间。 */
export function periodStart(period: LeaderboardPeriod, now: Date = new Date()): Date | null {
  if (period === "all") return null;
  if (period === "week") return startOfWeek(now);
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === "month") d.setDate(1);
  return d; // day = 今日 00:00
}

/** 付费推荐位：本期唯一可推广对象 = 数字藏品实例（user_collectibles.id） */
export const PROMOTE_CONTENT_TYPE = "collectible";
/** 可选推广时长（天） */
export const PROMOTE_DAYS = [1, 3, 7] as const;
/** 推广定价（积分）：1 天 100 / 3 天 250 / 7 天 500 */
export const PROMOTE_PRICING: Record<number, number> = { 1: 100, 3: 250, 7: 500 };
/** 排行榜顶部推荐位坑位数 */
export const PROMOTED_SLOT_LIMIT = 3;
