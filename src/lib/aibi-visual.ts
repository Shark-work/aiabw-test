/**
 * 艾比平台 Phase 5 · 前端视觉映射（纯函数/纯数据，零 React 依赖）
 *
 * 单一数据源原则：稀有度颜色/名称来自 aibi-catalog.ts（后端同源）；
 * 本模块仅补充「展示层独有」的映射：物种 emoji 立绘占位、稀有度动画档位。
 * AibiCard / PackOpenAnimation / 契约测试三方共用，保证视觉口径一致。
 */
import { getAibiRarity, type AibiRarity } from "./aibi-catalog";

// ---------- 物种 emoji 立绘占位（正式素材落地前的前端展示） ----------
export const AIBI_SPECIES_EMOJI: Record<string, string> = {
  "moss-turtle": "🐢",
  "magma-monkey": "🐒",
  "rock-beetle": "🪲",
  "mist-fox": "🦊",
  "steel-beast": "🤖",
  "frost-wolf": "🐺",
  "frost-bird": "🐦",
  "volt-snake": "🐍",
  "pyro-dragon": "🐉",
  "wind-spirit": "🌪️",
  "light-butterfly": "🦋",
  "star-cat": "🐱",
};

export function aibiSpeciesEmoji(speciesId: string): string {
  return AIBI_SPECIES_EMOJI[speciesId] ?? "✨";
}

// ---------- 稀有度动画档位（Phase 5 · 5.2 五档开包动画） ----------
/**
 * 档位语义：
 *  1 common    落卡 + 简单光效
 *  2 rare      卡面翻转 + 元素光效
 *  3 epic      专属背景 + 光柱 + 卡面展开
 *  4 legendary 全屏登场 + 形象放大 + 凭证编号出现
 *  5 mythic    全屏登场 + 凭证生成动画 + AI 自我介绍
 */
export type RarityAnimationTier = 1 | 2 | 3 | 4 | 5;

const TIER_BY_RARITY: Record<string, RarityAnimationTier> = {
  common: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
};

export function animationTierForRarity(rarityId: string): RarityAnimationTier {
  return TIER_BY_RARITY[rarityId] ?? 1;
}

// ---------- 稀有度展示元数据（颜色取自 catalog，单源） ----------
export interface RarityVisual {
  rarity: AibiRarity | null;
  id: string;
  /** 展示色（catalog 色值；未知档位用普通色兜底） */
  color: string;
  emoji: string;
  tier: RarityAnimationTier;
}

const RARITY_EMOJI: Record<string, string> = {
  common: "⬜",
  rare: "🟦",
  epic: "🟪",
  legendary: "🟧",
  mythic: "🟥",
};

export function rarityVisual(rarityId: string): RarityVisual {
  const rarity = getAibiRarity(rarityId) ?? null;
  return {
    rarity,
    id: rarityId,
    color: rarity?.color ?? "#9EAEB8",
    emoji: RARITY_EMOJI[rarityId] ?? "✨",
    tier: animationTierForRarity(rarityId),
  };
}

// ---------- 元素文案（Phase 7/8 · 卡片/图鉴/详情页共用） ----------
/** catalog.species.element 存中文词（自然/火/冰/雷/光/岩/风），此处补英文展示映射。 */
export const AIBI_ELEMENT_I18N: Record<string, { zh: string; en: string }> = {
  自然: { zh: "自然", en: "Nature" },
  火: { zh: "火", en: "Fire" },
  冰: { zh: "冰", en: "Ice" },
  雷: { zh: "雷", en: "Thunder" },
  光: { zh: "光", en: "Light" },
  岩: { zh: "岩", en: "Rock" },
  风: { zh: "风", en: "Wind" },
};

export function aibiElementLabel(element: string, locale: string): string {
  const hit = AIBI_ELEMENT_I18N[element];
  if (!hit) return element;
  return locale === "en" ? hit.en : hit.zh;
}

/** 凭证编号展示格式（文档示例：Aibi #000128）；存储格式 AIBI-000128 不变。 */
export function aibiCertDisplay(aibiTokenId: string): string {
  if (!aibiTokenId) return "—";
  return aibiTokenId.replace(/^AIBI-/, "Aibi #");
}

/**
 * 物种 → 卡片展示 DTO（图鉴/codex 用，阶段 7「统一 AibiCard」约束）：
 * 物种级展示没有凭证实例，tokenId 置空（卡片显示 —）、status 由调用方经 statusTag 覆盖。
 */
export function speciesCardToken(sp: NonNullable<AibiTokenDto["species"]>): AibiTokenDto {
  return {
    aibiTokenId: "",
    speciesId: sp.id,
    status: "codex",
    physicalBound: false,
    createdAt: "",
    personalityType: null,
    mood: null,
    affinity: null,
    energy: null,
    growthLevel: null,
    growthExp: null,
    species: sp,
  };
}

// ---------- 道具 emoji（道具商店/背包共用，单一数据源 · Phase 6 · 6.3） ----------
export const AIBI_ITEM_EMOJI: Record<string, string> = {
  energy_fruit: "🍎",
  affinity_candy: "🍬",
  training_core: "🧠",
  evolution_stone: "💎",
  repair_chip: "🔧",
};

export function aibiItemEmoji(itemId: string): string {
  return AIBI_ITEM_EMOJI[itemId] ?? "🎁";
}

// ---------- 开包结果 / 背包通用的 DTO 类型（与 Phase 4 API 响应一致） ----------
export interface AibiTokenDto {
  aibiTokenId: string;
  speciesId: string;
  status: string;
  physicalBound: boolean;
  /** Aibi ↔ 聊天（方案 a）：已绑定的对话线程；NULL=未创建（按钮显示「创建聊天」） */
  threadId?: string | null;
  createdAt: string;
  personalityType: string | null;
  mood: string | null;
  affinity: number | null;
  energy: number | null;
  growthLevel: number | null;
  growthExp: number | null;
  species: {
    id: string;
    nameZh: string;
    nameEn: string;
    rarityId: string;
    element: string;
    habitatId: string;
    description: string;
    descriptionEn: string;
    personalityTemplate: string;
    personalityTemplateEn: string;
    animationLevel: number;
    supports3d: boolean;
    supportsChat: boolean;
  } | null;
}
