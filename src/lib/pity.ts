/**
 * 盲盒保底系统（产品升级 Phase 6 · 指令 4）。
 *
 * 规则（与实施计划 8.4 对齐）：
 *  - 每次抽取 pull_count +1；
 *  - 抽出「稀有物品」（PITY_RESET_RARITIES：史诗/传说）即清零；
 *  - pull_count +1 达到 PITY_THRESHOLD（50）时本次强制出货（保底），并清零；
 *  - 计数存 pity_counter 表（v19 既有，复合主键 user_id+pool_id，零 schema 变更）。
 *
 * 保底稀有度裁定：池内 ≥ epic 档且权重 > 0 的最高档；
 * 池子不含 epic+（如纯 common/rare 福利池）→ 池内最高档兜底（保底必有意义）。
 */
export const PITY_THRESHOLD = 50;

/** 稀有度档位（低→高），与 blindbox 概率表 key 对齐。 */
export const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary"] as const;

/** 抽出即清零 pull_count 的「稀有物品」口径：史诗及以上。 */
export const PITY_RESET_RARITIES = ["epic", "legendary"] as const;

export function isPityResetRarity(rarity: string): boolean {
  return (PITY_RESET_RARITIES as readonly string[]).includes(rarity);
}

/**
 * 保底触发时强制发放的稀有度：
 *  1) 池内权重 > 0 且 ≥ epic 的最高档；
 *  2) 池子无 epic+ → 池内权重 > 0 的最高档（保底仍优于常规期望）。
 * 概率表为空 → "epic"（理论不可达：draw 上游 weightedPick 空表回退 common，此处仅防御）。
 */
export function pickPityRarity(probabilities: Record<string, number> | null | undefined): string {
  const probs = probabilities ?? {};
  const available = RARITY_ORDER.filter((r) => Number(probs[r] ?? 0) > 0);
  if (available.length === 0) return "epic";
  const epicPlus = available.filter((r) => (PITY_RESET_RARITIES as readonly string[]).includes(r));
  return (epicPlus.length > 0 ? epicPlus : available)[
    (epicPlus.length > 0 ? epicPlus : available).length - 1
  ];
}
