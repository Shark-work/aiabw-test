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

/** 返回本周一 00:00（本地时区），用于「本周繁育达人榜」统计窗口。 */
export function startOfWeek(now: Date = new Date()): Date {
  const d = new Date(now);
  const day = d.getDay() === 0 ? 7 : d.getDay(); // 周日=7
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (day - 1));
  return d;
}

/** 排行榜默认展示数量 */
export const LEADERBOARD_LIMIT = 20;
