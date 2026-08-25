// NFR 基因遗传算法（纯函数，无 DB / 无 Next 依赖，便于单元测试）：
//  - breedDna：双亲 DNA 交叉（元素 50/50、性格交叉+变异、稀有度按链遗传+小概率突变）
//  - makeNfrHashId：确权哈希（sha256，唯一防伪）
//  - 常量：繁育/转赠积分费用、转赠冷却期、繁育冷却期
import crypto from "crypto";

export const RARITY_CHAIN = ["common", "uncommon", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITY_CHAIN)[number];

/** 繁育一次消耗的积分 */
export const BREED_COST = 200;
/** 转赠费用（第一阶段免转赠费） */
export const TRANSFER_FEE = 0;
/** 铸造/转赠后，新主人的转赠冷却期：7 天 */
export const TRANSFER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
/** 首次铸造后的转赠冷却期：24 小时（防刚领养就转手） */
export const FIRST_MINT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** 亲本繁育冷却期：7 天（防无限繁殖） */
export const BREED_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export type Dna = {
  element?: string;
  personality?: string;
  rarity?: string;
  seed?: string;
  [k: string]: unknown;
};

const PERSONALITY_POOL = [
  "勇敢", "温柔", "机灵", "高傲", "慵懒", "粘人", "活泼", "沉稳", "神秘", "治愈",
];
const MUTATION_RATE = 0.08;
const RARITY_MUTATION_RATE = 0.12;

const pick = <T,>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];
const chance = (p: number) => Math.random() < p;

/** 稀有度 → 链索引（未知回退 common=0）。 */
export function rarityIndex(rarity?: string | null): number {
  const i = RARITY_CHAIN.indexOf((rarity ?? "") as Rarity);
  return i === -1 ? 0 : i;
}

/**
 * 基因遗传算法：
 *  - element：50/50 随机继承双亲之一（双方均无则随机）；
 *  - personality：50/50 交叉继承 + 8% 变异；
 *  - rarity：默认取双亲中较低稀有度（保底不高于双亲），12% 概率 ±1 级突变（clamp 链内）；
 *  - seed：随机唯一性种子，确保同一对亲本可产出不同子代。
 */
export function breedDna(a: Dna, b: Dna): Dna {
  const element =
    chance(0.5) ? a.element ?? b.element : b.element ?? a.element;
  let personality = chance(0.5) ? a.personality : b.personality;
  if (chance(MUTATION_RATE) || !personality) personality = pick(PERSONALITY_POOL);

  const base = RARITY_CHAIN[Math.min(rarityIndex(a.rarity), rarityIndex(b.rarity))];
  let rarity = base;
  if (chance(RARITY_MUTATION_RATE)) {
    const dir = chance(0.5) ? 1 : -1;
    rarity = RARITY_CHAIN[
      Math.max(0, Math.min(RARITY_CHAIN.length - 1, rarityIndex(rarity) + dir))
    ];
  }

  return {
    ...b,
    ...a,
    element: element || pick(["fire", "water", "earth", "air"]),
    personality,
    rarity,
    seed: Math.random().toString(36).slice(2, 10),
  };
}

/**
 * 确权哈希：sha256(speciesId | dna | generation | ownerId | salt)。
 * 唯一性由 ownerId + 铸造时间 salt 保证；内容由 DNA 决定 → 防伪可校验。
 */
export function makeNfrHashId(
  speciesId: string,
  dna: Dna,
  generation: number,
  ownerId: string,
  salt: string,
): string {
  const raw = JSON.stringify({ speciesId, dna, generation, ownerId, salt });
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}
