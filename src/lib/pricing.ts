/**
 * 宠物稀有度 → 解锁价格阶梯（元）—— 商业化定价统一配置：
 *  - 等级标签 N / R / SR / SSR / UR（对应项目 rarity：common / uncommon / rare / epic / legendary）
 *  - 前端展示「解锁需 ¥X.X」；下单金额以此为准，不再各处写死。
 *  - 纯逻辑（无 DB / 无 Next 依赖），便于单元测试。
 */
export type RarityTier = "N" | "R" | "SR" | "SSR" | "UR";

/** 价格阶梯（单位：元）：N 普通 1.0 / R 稀有 6.6 / SR 史诗 12.8 / SSR 传说 19.9 / UR 神话 29.9 */
export const UNLOCK_PRICE_CNY: Record<RarityTier, number> = {
  N: 1.0,
  R: 6.6,
  SR: 12.8,
  SSR: 19.9,
  UR: 29.9,
};

/** 项目稀有度 → 等级档位（按稀有度顺序一一对应）。 */
export const TIER_FROM_RARITY: Record<string, RarityTier> = {
  common: "N",
  uncommon: "R",
  rare: "SR",
  epic: "SSR",
  legendary: "UR",
};

/** 稀有度 → 档位（未知/缺失回退 N）。 */
export function rarityTier(rarity?: string | null): RarityTier {
  if (rarity && TIER_FROM_RARITY[rarity]) return TIER_FROM_RARITY[rarity];
  return "N";
}

/** 按稀有度返回解锁价格（元）。 */
export function unlockPriceCny(rarity?: string | null): number {
  return UNLOCK_PRICE_CNY[rarityTier(rarity)];
}

/** 按稀有度返回解锁价格（保留一位小数字符串，如 "6.6"）。 */
export function unlockPriceCnyLabel(rarity?: string | null): string {
  return unlockPriceCny(rarity).toFixed(1);
}
