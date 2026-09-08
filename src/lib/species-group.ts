// 图鉴物种去重聚合（纯逻辑模块：catalog API / 详情页 SSR / 单元测试共用）。
//  - pets 表同一 species_id 存在多条实例（不同 traits.rarity 变体），
//    图鉴按物种聚合：每物种一张卡，展示稀有度最高的记录；
//  - 领养目标 claimTarget = 组内未拥有实例中稀有度最高的一条
//    （最高稀有度被领光时自动降级，物种永远可领，除非全版本领光）。

/** 稀有度权重（legendary > epic > rare > uncommon > common，未知 → 0）。 */
export const RARITY_WEIGHT: Record<string, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

/** 稀有度 → 权重（未知/缺失回退 0，排在已知稀有度之后）。 */
export function rarityWeight(rarity?: string | null): number {
  return (rarity != null && RARITY_WEIGHT[rarity]) || 0;
}

/** groupBySpecies 的最小输入约束（catalog 行 / 测试桩均满足）。 */
export type SpeciesGroupSource = {
  id: string;
  speciesId: string;
  traits?: { rarity?: string | null; [k: string]: unknown } | null;
  owned?: boolean | null;
};

/** 物种聚合卡：rep 用于展示，claimTarget 用于领养。 */
export type SpeciesCard<T extends SpeciesGroupSource> = {
  speciesId: string;
  /** 展示记录：组内稀有度最高的实例（含已拥有的）。 */
  rep: T;
  /** 组内全部实例，按稀有度权重降序（同权重保持原顺序）。 */
  variants: T[];
  /** 组内不同稀有度的种数（"共 X 种版本"）。 */
  variantCount: number;
  /** 领养目标：组内未拥有实例中稀有度最高的一条；全领光 → null。 */
  claimTarget: T | null;
  /** 组内是否所有实例均已被领养。 */
  allOwned: boolean;
};

/** 统计列表中不同稀有度的种数（缺 rarity 的行不计入）。 */
export function distinctRarityCount(
  pets: { traits?: { rarity?: string | null } | null }[],
): number {
  const set = new Set<string>();
  for (const p of pets) {
    const r = p.traits?.rarity;
    if (r) set.add(r);
  }
  return set.size;
}

/**
 * 按物种（speciesId）聚合宠物实例列表：
 *  - 每物种一张卡，rep = 稀有度最高的记录（排序：legendary > … > common > 未知）；
 *  - claimTarget = 组内未拥有的最高稀有度实例（领光则 null）；
 *  - speciesId 缺失时按实例自身退化为一组（不吞数据）。
 */
export function groupBySpecies<T extends SpeciesGroupSource>(pets: T[]): SpeciesCard<T>[] {
  const groups = new Map<string, T[]>();
  for (const p of pets) {
    const key = p.speciesId || p.id;
    const arr = groups.get(key);
    if (arr) arr.push(p);
    else groups.set(key, [p]);
  }
  const cards: SpeciesCard<T>[] = [];
  for (const [speciesId, list] of groups) {
    // 稀有度降序；Array.prototype.sort 稳定 → 同权重保持原顺序（created_at DESC）
    const variants = [...list].sort(
      (a, b) => rarityWeight(b.traits?.rarity) - rarityWeight(a.traits?.rarity),
    );
    const claimTarget = variants.find((p) => !p.owned) ?? null;
    cards.push({
      speciesId,
      rep: variants[0],
      variants,
      variantCount: distinctRarityCount(variants),
      claimTarget,
      allOwned: claimTarget === null,
    });
  }
  return cards;
}
