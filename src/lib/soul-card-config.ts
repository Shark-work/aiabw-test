/**
 * Aibi Soul Card · 共享纯配置（前后端共用，禁止引入服务端依赖）
 * ----------------------------------------------------------------
 * 平台升级 Phase 1（2026-09-30）：灵魂卡领域常量与纯函数。
 *  - 稀有度 5 级与既有进化系统（drizzle/0014）完全对齐：common → legendary；
 *  - 元素 4 系与既有 genetics.ts / blindbox.ts 的取值对齐：fire/water/earth/air；
 *  - 成长阶段：seed → sprout → bloom → radiant（按 growth_level 推导，不落库冗余列
 *    之外的阶段逻辑；soul_cards.growth_stage 仅是写入时的快照，展示以 level 实时推导为准）；
 *  - 凭证编号：AIBI-{tokenId 六位补齐}，由链上 tokenId 派生，全局唯一。
 */

export const SOUL_CARD_RARITIES = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
] as const;
export type SoulCardRarity = (typeof SOUL_CARD_RARITIES)[number];

/** 稀有度排序权重（数值越大越稀有），用于列表排序与比较。 */
export const RARITY_ORDER: Record<SoulCardRarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

export const RARITY_META: Record<
  SoulCardRarity,
  { emoji: string; labelZh: string; labelEn: string; badgeClass: string; frameClass: string }
> = {
  common: {
    emoji: "⚪",
    labelZh: "普通",
    labelEn: "Common",
    badgeClass: "bg-zinc-100 text-zinc-600",
    frameClass: "from-zinc-300 to-zinc-200",
  },
  uncommon: {
    emoji: "🟢",
    labelZh: "优秀",
    labelEn: "Uncommon",
    badgeClass: "bg-emerald-100 text-emerald-700",
    frameClass: "from-emerald-300 to-teal-200",
  },
  rare: {
    emoji: "🔵",
    labelZh: "稀有",
    labelEn: "Rare",
    badgeClass: "bg-sky-100 text-sky-700",
    frameClass: "from-sky-400 to-indigo-300",
  },
  epic: {
    emoji: "🟣",
    labelZh: "史诗",
    labelEn: "Epic",
    badgeClass: "bg-violet-100 text-violet-700",
    frameClass: "from-violet-500 to-fuchsia-400",
  },
  legendary: {
    emoji: "🟠",
    labelZh: "传说",
    labelEn: "Legendary",
    badgeClass: "bg-amber-100 text-amber-700",
    frameClass: "from-amber-400 via-orange-400 to-rose-400",
  },
};

export const SOUL_CARD_ELEMENTS = ["fire", "water", "earth", "air"] as const;
export type SoulCardElement = (typeof SOUL_CARD_ELEMENTS)[number];

export const ELEMENT_META: Record<
  SoulCardElement,
  { emoji: string; labelZh: string; labelEn: string }
> = {
  fire: { emoji: "🔥", labelZh: "火", labelEn: "Fire" },
  water: { emoji: "💧", labelZh: "水", labelEn: "Water" },
  earth: { emoji: "🌱", labelZh: "土", labelEn: "Earth" },
  air: { emoji: "🌪️", labelZh: "风", labelEn: "Air" },
};

/** 成长阶段（按等级区间推导；minLevel 为进入该阶段的最低等级）。 */
export const GROWTH_STAGES = [
  { id: "seed", minLevel: 1, emoji: "🌰", labelZh: "种子", labelEn: "Seed" },
  { id: "sprout", minLevel: 10, emoji: "🌱", labelZh: "萌芽", labelEn: "Sprout" },
  { id: "bloom", minLevel: 30, emoji: "🌸", labelZh: "绽放", labelEn: "Bloom" },
  { id: "radiant", minLevel: 60, emoji: "🌟", labelZh: "光耀", labelEn: "Radiant" },
] as const;
export type GrowthStageId = (typeof GROWTH_STAGES)[number]["id"];
export type GrowthStage = (typeof GROWTH_STAGES)[number];

export const GROWTH_LEVEL_MAX = 99;

/** 按等级推导成长阶段（取 minLevel <= level 的最后一个阶段）。 */
export function stageForLevel(level: number): GrowthStage {
  let stage: GrowthStage = GROWTH_STAGES[0];
  for (const s of GROWTH_STAGES) {
    if (level >= s.minLevel) stage = s;
  }
  return stage;
}

/** 当前等级升到下一级所需经验（线性：level × 100；满级后恒为 0）。 */
export function expToNextLevel(level: number): number {
  if (level >= GROWTH_LEVEL_MAX) return 0;
  return Math.max(1, Math.trunc(level)) * 100;
}

export type GrowthResult = {
  level: number;
  exp: number;
  stage: GrowthStageId;
  leveledUp: boolean;
};

/**
 * 经验结算纯函数（供后续互动/探索节点接入成长）：
 * exp 为当前等级内进度；经验溢出自动连升，封顶 GROWTH_LEVEL_MAX。
 */
export function applyGrowthExp(
  level: number,
  exp: number,
  delta: number,
): GrowthResult {
  let lv = Math.max(1, Math.trunc(level));
  let cur = Math.max(0, Math.trunc(exp)) + Math.max(0, Math.trunc(delta));
  const startLevel = lv;
  while (lv < GROWTH_LEVEL_MAX) {
    const need = expToNextLevel(lv);
    if (cur < need) break;
    cur -= need;
    lv += 1;
  }
  if (lv >= GROWTH_LEVEL_MAX) cur = 0;
  return { level: lv, exp: cur, stage: stageForLevel(lv).id, leveledUp: lv > startLevel };
}

/** 链上凭证编号：AIBI-000001（tokenId 六位补齐，全局唯一）。 */
export function certificateNoForTokenId(tokenId: number): string {
  return `AIBI-${String(Math.trunc(tokenId)).padStart(6, "0")}`;
}

/** chain_supply 供应单例行 id（固定 1）。 */
export const CHAIN_SUPPLY_SINGLETON_ID = 1;
/** 默认发行上限（可用 CHAIN_MAX_SUPPLY 环境变量覆盖，见 src/server/chain/chain-config.ts）。 */
export const DEFAULT_MAX_SUPPLY = 100000;

/** 规范化稀有度：非法/缺失值回退 common（与既有 traits 数据兼容）。 */
export function normalizeRarity(value: unknown): SoulCardRarity {
  return (SOUL_CARD_RARITIES as readonly string[]).includes(String(value))
    ? (value as SoulCardRarity)
    : "common";
}

/** 规范化元素：非法/缺失值回退 earth。 */
export function normalizeElement(value: unknown): SoulCardElement {
  return (SOUL_CARD_ELEMENTS as readonly string[]).includes(String(value))
    ? (value as SoulCardElement)
    : "earth";
}
