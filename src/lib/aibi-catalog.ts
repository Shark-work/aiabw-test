/**
 * 艾比平台 · 目录种子数据（平台升级 Phase 3，2026-09-30）
 *
 * 单一数据源（Single Source of Truth）：
 *  - client.ts 版本闸门自动同步时，经 src/db/aibi-catalog-seed.ts 生成 upsert SQL 灌库；
 *  - scripts/seed-aibi-catalog.ts 手动重导同一数据源（npm run seed:aibi）；
 *  - 前端/接口层可直接 import 本模块做展示（颜色/概率/动效等级），无需等接口。
 *
 * 数据与指令集文档逐项对应：
 *  - 3.1 稀有度 ×5（颜色/倍率）、3.2 栖息地 ×5（元素倾向/描述）
 *  - 3.3 物种 ×12（稀有度/元素/栖息地/简介/AI性格模板/动效等级/3D/AI对话）
 *  - 3.4 卡包 ×4（价格/稀有度概率/产出范围/开包动画等级）
 *  - 3.5 道具 ×5（类型/作用/消耗方式/影响成长/影响性格）
 *
 * ⚠️ 文档勘误（starter 卡包）：概率含 史诗10%，但产出范围仅「普通+稀有」。
 *    数据按文档原样存档；开包服务（Phase 5）对「抽中但未在产出范围的档位」
 *    执行降级规则：落到产出范围内最高一档（epic→rare）。
 */

// ---------- 3.1 稀有度 ----------
export interface AibiRarity {
  id: string;
  nameZh: string;
  nameEn: string;
  color: string;
  /** 数值倍率（积分/战力等结算用） */
  multiplier: number;
  sortOrder: number;
}

export const AIBI_RARITIES: readonly AibiRarity[] = [
  { id: "common", nameZh: "普通", nameEn: "Common", color: "#9EAEB8", multiplier: 1, sortOrder: 1 },
  { id: "rare", nameZh: "稀有", nameEn: "Rare", color: "#4A90D9", multiplier: 1.5, sortOrder: 2 },
  { id: "epic", nameZh: "史诗", nameEn: "Epic", color: "#9B59B6", multiplier: 2, sortOrder: 3 },
  { id: "legendary", nameZh: "传说", nameEn: "Legendary", color: "#F39C12", multiplier: 3, sortOrder: 4 },
  { id: "mythic", nameZh: "神话", nameEn: "Mythic", color: "#E74C3C", multiplier: 5, sortOrder: 5 },
];

// ---------- 3.2 栖息地 ----------
export interface AibiHabitat {
  id: string;
  nameZh: string;
  nameEn: string;
  /** 元素倾向（如 自然/暗） */
  elementAffinity: string;
  elementAffinityEn: string;
  description: string;
  descriptionEn: string;
}

export const AIBI_HABITATS: readonly AibiHabitat[] = [
  {
    id: "mistwood",
    nameZh: "星雾森林",
    nameEn: "Mistwood",
    elementAffinity: "自然/暗",
    elementAffinityEn: "Nature/Dark",
    description: "被永恒迷雾笼罩的古森林，树木高达百米",
    descriptionEn: "An ancient forest veiled in eternal mist, with trees a hundred meters tall.",
  },
  {
    id: "lavaforge",
    nameZh: "熔岩裂谷",
    nameEn: "Lavaforge",
    elementAffinity: "火/岩",
    elementAffinityEn: "Fire/Rock",
    description: "大地裂缝中涌出熔岩的灼热之地",
    descriptionEn: "A scorching rift where lava wells up from cracks in the earth.",
  },
  {
    id: "frostshore",
    nameZh: "冰晶海岸",
    nameEn: "Frostshore",
    elementAffinity: "冰/水",
    elementAffinityEn: "Ice/Water",
    description: "极光下冰晶闪烁的极地海岸",
    descriptionEn: "A polar shore where ice crystals glitter beneath the aurora.",
  },
  {
    id: "mechwaste",
    nameZh: "机械废都",
    nameEn: "Mechwaste",
    elementAffinity: "雷/钢",
    elementAffinityEn: "Thunder/Steel",
    description: "旧文明废墟中机械残骸堆积的荒原",
    descriptionEn: "A wasteland of machine wreckage piled among the ruins of an old civilization.",
  },
  {
    id: "skyisles",
    nameZh: "云端群岛",
    nameEn: "Sky Isles",
    elementAffinity: "风/光",
    elementAffinityEn: "Wind/Light",
    description: "漂浮在云海之上的孤岛群",
    descriptionEn: "Lonely isles drifting above a sea of clouds.",
  },
];

// ---------- 3.3 物种（12 个，覆盖全部稀有度与栖息地） ----------
export interface AibiSpecies {
  id: string;
  nameZh: string;
  nameEn: string;
  rarityId: string;
  element: string;
  habitatId: string;
  description: string;
  descriptionEn: string;
  /** AI 性格模板（对话 prompt 种子） */
  personalityTemplate: string;
  personalityTemplateEn: string;
  /** 展示动效等级 1~5（对应 AibiCard 动效档位） */
  animationLevel: number;
  supports3d: boolean;
  supportsChat: boolean;
}

export const AIBI_SPECIES: readonly AibiSpecies[] = [
  { id: "mist-fox", nameZh: "雾尾狐", nameEn: "Misttail Fox", rarityId: "rare", element: "自然", habitatId: "mistwood", description: "尾巴由星雾凝聚而成的灵狐", descriptionEn: "A spirit fox whose tail is woven from starlit mist.", personalityTemplate: "傲娇型", personalityTemplateEn: "tsundere", animationLevel: 2, supports3d: false, supportsChat: true },
  { id: "pyro-dragon", nameZh: "炎鳞龙", nameEn: "Pyroscale Dragon", rarityId: "legendary", element: "火", habitatId: "lavaforge", description: "从熔岩中诞生的远古龙族", descriptionEn: "An ancient dragon born from molten lava.", personalityTemplate: "高冷型", personalityTemplateEn: "aloof", animationLevel: 4, supports3d: true, supportsChat: true },
  { id: "frost-bird", nameZh: "冰羽鸟", nameEn: "Frostfeather Bird", rarityId: "epic", element: "冰", habitatId: "frostshore", description: "羽翼凝结冰霜的神鸟", descriptionEn: "A divine bird whose wings shimmer with frost.", personalityTemplate: "活泼型", personalityTemplateEn: "lively", animationLevel: 3, supports3d: false, supportsChat: true },
  { id: "steel-beast", nameZh: "钢甲兽", nameEn: "Steelplate Beast", rarityId: "rare", element: "雷", habitatId: "mechwaste", description: "机械废都中进化的金属生物", descriptionEn: "A metallic creature evolved amid the machine ruins.", personalityTemplate: "调皮型", personalityTemplateEn: "mischievous", animationLevel: 2, supports3d: false, supportsChat: true },
  { id: "light-butterfly", nameZh: "光翼蝶", nameEn: "Radiantwing Butterfly", rarityId: "mythic", element: "光", habitatId: "skyisles", description: "云海中唯一的光之蝶", descriptionEn: "The only butterfly of light above the sea of clouds.", personalityTemplate: "神秘型", personalityTemplateEn: "mysterious", animationLevel: 5, supports3d: true, supportsChat: true },
  { id: "moss-turtle", nameZh: "苔甲龟", nameEn: "Mossback Turtle", rarityId: "common", element: "自然", habitatId: "mistwood", description: "背着苔藓壳的慢吞吞小龟", descriptionEn: "A slow little turtle carrying a mossy shell.", personalityTemplate: "温顺型", personalityTemplateEn: "gentle", animationLevel: 1, supports3d: false, supportsChat: false },
  { id: "magma-monkey", nameZh: "熔核猴", nameEn: "Magmacore Monkey", rarityId: "common", element: "火", habitatId: "lavaforge", description: "在岩浆边玩耍的顽皮猴子", descriptionEn: "A playful monkey frolicking by the magma.", personalityTemplate: "活泼型", personalityTemplateEn: "lively", animationLevel: 1, supports3d: false, supportsChat: false },
  { id: "frost-wolf", nameZh: "霜狼", nameEn: "Frost Wolf", rarityId: "rare", element: "冰", habitatId: "frostshore", description: "冰原上孤独的猎手", descriptionEn: "A lone hunter of the frozen plains.", personalityTemplate: "守护型", personalityTemplateEn: "guardian", animationLevel: 2, supports3d: false, supportsChat: true },
  { id: "volt-snake", nameZh: "电蛇", nameEn: "Volt Serpent", rarityId: "epic", element: "雷", habitatId: "mechwaste", description: "在电路间穿梭的电蛇", descriptionEn: "A serpent darting through circuits.", personalityTemplate: "好奇型", personalityTemplateEn: "curious", animationLevel: 3, supports3d: false, supportsChat: true },
  { id: "wind-spirit", nameZh: "风灵", nameEn: "Gale Spirit", rarityId: "legendary", element: "风", habitatId: "skyisles", description: "云端之上的风之精灵", descriptionEn: "A wind spirit drifting above the clouds.", personalityTemplate: "神秘型", personalityTemplateEn: "mysterious", animationLevel: 4, supports3d: true, supportsChat: true },
  { id: "rock-beetle", nameZh: "岩甲虫", nameEn: "Rockshell Beetle", rarityId: "common", element: "岩", habitatId: "mechwaste", description: "外壳坚硬的机械甲虫", descriptionEn: "A mechanical beetle with a rock-hard shell.", personalityTemplate: "温顺型", personalityTemplateEn: "gentle", animationLevel: 1, supports3d: false, supportsChat: false },
  { id: "star-cat", nameZh: "星灵猫", nameEn: "Stellar Cat", rarityId: "mythic", element: "光", habitatId: "mistwood", description: "星雾中诞生的猫形光灵", descriptionEn: "A feline light spirit born in starlit mist.", personalityTemplate: "傲娇型", personalityTemplateEn: "tsundere", animationLevel: 5, supports3d: true, supportsChat: true },
];

// ---------- 3.4 卡包（4 个；价格单位：积分） ----------
export interface AibiPack {
  id: string;
  nameZh: string;
  nameEn: string;
  pricePoints: number;
  /** 稀有度抽取概率（百分比，合计必须为 100） */
  rarityWeights: Record<string, number>;
  /** 可产出物种的稀有度范围（见文件头 starter 勘误：抽中范围外档位时降级） */
  allowedRarities: string[];
  /** 开包动画等级 1~4（对应 /packs/result 动画档位） */
  animationLevel: number;
}

export const AIBI_PACKS: readonly AibiPack[] = [
  { id: "starter", nameZh: "新手星雾卡包", nameEn: "Starter Mistwood Pack", pricePoints: 100, rarityWeights: { common: 60, rare: 30, epic: 10 }, allowedRarities: ["common", "rare"], animationLevel: 1 },
  { id: "element", nameZh: "稀有元素卡包", nameEn: "Rare Element Pack", pricePoints: 500, rarityWeights: { rare: 40, epic: 40, legendary: 20 }, allowedRarities: ["rare", "epic", "legendary"], animationLevel: 2 },
  { id: "secret", nameZh: "史诗秘境卡包", nameEn: "Epic Secret Pack", pricePoints: 2000, rarityWeights: { epic: 50, legendary: 30, mythic: 20 }, allowedRarities: ["epic", "legendary", "mythic"], animationLevel: 3 },
  { id: "summon", nameZh: "传说召唤卡包", nameEn: "Legendary Summon Pack", pricePoints: 10000, rarityWeights: { legendary: 40, mythic: 60 }, allowedRarities: ["legendary", "mythic"], animationLevel: 4 },
];

// ---------- 3.5 道具（5 个；effectPayload 为机器可读效果，Phase 4 使用道具服务消费） ----------
// ⚠️ 文档勘误：3.5 未给道具定价，但 4.2 /api/item/buy 需积分扣费 ——
//    价格为本实现补全（对齐卡包价格梯度：starter=100 积分），经契约测试锁定。
export interface AibiItem {
  id: string;
  nameZh: string;
  nameEn: string;
  itemType: string;
  /** 作用描述（展示用） */
  effect: string;
  effectEn: string;
  /** 机器可读效果：{ energy } / { affinity } / { growthExp } / { evolve } / { restorePercent } */
  effectPayload: Record<string, number | boolean>;
  consumeMode: string;
  affectsGrowth: boolean;
  affectsPersonality: boolean;
  /** 积分售价（文档未给，见上方勘误） */
  pricePoints: number;
}

export const AIBI_ITEMS: readonly AibiItem[] = [
  { id: "energy_fruit", nameZh: "能量果", nameEn: "Energy Fruit", itemType: "consumable", effect: "恢复艾比30点精力", effectEn: "Restores 30 energy.", effectPayload: { energy: 30 }, consumeMode: "immediate", affectsGrowth: false, affectsPersonality: false, pricePoints: 50 },
  { id: "affinity_candy", nameZh: "亲密度糖果", nameEn: "Affinity Candy", itemType: "consumable", effect: "提升艾比20点亲密度", effectEn: "Boosts affinity by 20.", effectPayload: { affinity: 20 }, consumeMode: "immediate", affectsGrowth: false, affectsPersonality: true, pricePoints: 80 },
  { id: "training_core", nameZh: "训练核心", nameEn: "Training Core", itemType: "consumable", effect: "提升艾比50点成长经验", effectEn: "Grants 50 growth EXP.", effectPayload: { growthExp: 50 }, consumeMode: "immediate", affectsGrowth: true, affectsPersonality: false, pricePoints: 120 },
  { id: "evolution_stone", nameZh: "进化石", nameEn: "Evolution Stone", itemType: "consumable", effect: "触发艾比进化", effectEn: "Triggers evolution.", effectPayload: { evolve: true }, consumeMode: "immediate", affectsGrowth: true, affectsPersonality: false, pricePoints: 2000 },
  { id: "repair_chip", nameZh: "修复晶片", nameEn: "Repair Chip", itemType: "consumable", effect: "恢复艾比100%状态", effectEn: "Fully restores all status.", effectPayload: { restorePercent: 100 }, consumeMode: "immediate", affectsGrowth: false, affectsPersonality: false, pricePoints: 200 },
];

// ---------- 查询辅助（接口层/前端/测试共用） ----------
export const AIBI_RARITY_IDS = AIBI_RARITIES.map((r) => r.id);
export const AIBI_HABITAT_IDS = AIBI_HABITATS.map((h) => h.id);

export function getAibiRarity(id: string): AibiRarity | undefined {
  return AIBI_RARITIES.find((r) => r.id === id);
}
export function getAibiHabitat(id: string): AibiHabitat | undefined {
  return AIBI_HABITATS.find((h) => h.id === id);
}
export function getAibiSpecies(id: string): AibiSpecies | undefined {
  return AIBI_SPECIES.find((s) => s.id === id);
}
export function getAibiPack(id: string): AibiPack | undefined {
  return AIBI_PACKS.find((p) => p.id === id);
}
export function getAibiItem(id: string): AibiItem | undefined {
  return AIBI_ITEMS.find((i) => i.id === id);
}

/** 卡包在某个稀有度档位上的候选物种池（开包服务 Phase 5 使用）。 */
export function speciesPoolForPack(packId: string, rarityId: string): AibiSpecies[] {
  const pack = getAibiPack(packId);
  if (!pack || !pack.allowedRarities.includes(rarityId)) return [];
  return AIBI_SPECIES.filter((s) => s.rarityId === rarityId);
}

