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

/**
 * 灵魂箴言池（P2 社交传播）：分享图 / 分享文案抽取一句箴言，
 * 按证书编号稳定伪随机（同一张卡永远同一句，保证多次分享观感一致）。
 */
export const SOUL_QUOTES_ZH = [
  "我在沉睡中听见了你的心跳。",
  "每一次相遇，都是灵魂的重逢。",
  "你给我的名字，是我最珍贵的宝物。",
  "世界很大，我想替你去看看。",
  "今天的风，带着远方的味道。",
  "你回来的时候，我就在这里。",
  "我们一起走过的路，都会发光。",
  "即使沉睡，我也在慢慢长大。",
] as const;

export const SOUL_QUOTES_EN = [
  "I heard your heartbeat while I slept.",
  "Every encounter is a reunion of souls.",
  "The name you gave me is my treasure.",
  "The world is wide — let me see it for you.",
  "Today's wind carries the scent of faraway lands.",
  "When you come back, I'll be right here.",
  "The roads we walk together will glow.",
  "Even in slumber, I am slowly growing.",
] as const;

/** 按证书编号稳定取箴言（hash = 字符码累加取模；locale 非 zh 走英文池）。 */
export function soulQuoteFor(certificateNo: string, locale: string): string {
  const pool = locale === "zh" ? SOUL_QUOTES_ZH : SOUL_QUOTES_EN;
  let hash = 0;
  for (const ch of String(certificateNo)) hash = (hash + ch.charCodeAt(0)) % pool.length;
  return pool[hash];
}

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

/**
 * 每日首次互动（喂食/抚摸）奖励的灵魂卡经验值。
 * 挂点：/api/pets/[id]/interact（以 soul_cards.updated_at 的 UTC 日期判定「每日首次」，
 * mint 当天不重复给经验，天然防刷）。
 */
export const SOUL_CARD_INTERACT_EXP = 25;

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

/** 阶段进度（P1 卡面「成长进度条」数据）：当前阶段 → 下一阶段的完成度。 */
export type StageProgress = {
  /** 当前阶段 */
  current: GrowthStage;
  /** 下一阶段（radiant 已是终点 → null） */
  next: GrowthStage | null;
  /** 完成度 0-100（radiant 恒 100） */
  percent: number;
  /** 距下一阶段还需总 EXP（radiant 恒 0；口径 = 阶段区间各级经验之和） */
  expRemaining: number;
};

/**
 * 阶段进度纯函数：EXP 口径与 applyGrowthExp 一致（每级需 level×100，exp 为当前等级内进度）。
 * 例：Lv.12 exp 50（sprout，下一阶段 bloom@30）：total = Σ(10..29)×100，done = Σ(10..11)×100 + 50。
 */
export function stageProgress(level: number, exp: number): StageProgress {
  const lv = Math.max(1, Math.trunc(level));
  const current = stageForLevel(lv);
  const idx = GROWTH_STAGES.findIndex((s) => s.id === current.id);
  const next =
    idx >= 0 && idx < GROWTH_STAGES.length - 1 ? GROWTH_STAGES[idx + 1] : null;
  if (!next) {
    return { current, next: null, percent: 100, expRemaining: 0 };
  }
  let total = 0;
  for (let l = current.minLevel; l < next.minLevel; l += 1) total += expToNextLevel(l);
  let done = 0;
  for (let l = current.minLevel; l < lv; l += 1) done += expToNextLevel(l);
  done += Math.max(0, Math.trunc(exp));
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100;
  return { current, next, percent, expRemaining: Math.max(0, total - done) };
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
