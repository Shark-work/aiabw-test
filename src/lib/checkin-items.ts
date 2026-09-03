// P0-1 每日签到 · 心情盲盒道具目录（纯数据模块：API 路由 / 客户端组件 / 单元测试共用）。
//  - 道具分 3 类（帽子 / 围巾 / 玩具）× 3 稀有度，连签每满 7 天随机开出一个；
//  - 稀有度权重：普通 70% / 稀有 25% / 传说 5%；
//  - 月卡用户保底稀有（roll 出普通时强制升级为稀有）。
// 目录放代码常量而非 DB 表：道具是运营配置（非用户数据），随版本演进，无需迁移。

export type ItemRarity = "common" | "rare" | "legendary";
export type ItemCategory = "hat" | "scarf" | "toy";

export type CheckinItem = {
  /** 唯一 key（入库 user_items.item_key） */
  key: string;
  category: ItemCategory;
  rarity: ItemRarity;
  nameZh: string;
  nameEn: string;
  emoji: string;
};

/** 签到盲盒道具目录（3 类 × 3 稀有度 = 9 件） */
export const CHECKIN_ITEMS: CheckinItem[] = [
  // 帽子
  { key: "hat_cap", category: "hat", rarity: "common", nameZh: "旧棒球帽", nameEn: "Worn Baseball Cap", emoji: "🧢" },
  { key: "hat_top", category: "hat", rarity: "rare", nameZh: "绅士礼帽", nameEn: "Gentleman's Top Hat", emoji: "🎩" },
  { key: "hat_crown", category: "hat", rarity: "legendary", nameZh: "黄金王冠", nameEn: "Golden Crown", emoji: "👑" },
  // 围巾
  { key: "scarf_knit", category: "scarf", rarity: "common", nameZh: "手织红围巾", nameEn: "Hand-knit Red Scarf", emoji: "🧣" },
  { key: "scarf_cloud", category: "scarf", rarity: "rare", nameZh: "羊绒云朵围巾", nameEn: "Cashmere Cloud Scarf", emoji: "🧶" },
  { key: "scarf_star", category: "scarf", rarity: "legendary", nameZh: "星光织带", nameEn: "Stellar Weaver Scarf", emoji: "✨" },
  // 玩具
  { key: "toy_ball", category: "toy", rarity: "common", nameZh: "弹跳网球", nameEn: "Bouncy Tennis Ball", emoji: "🎾" },
  { key: "toy_bone", category: "toy", rarity: "rare", nameZh: "会唱歌的骨头", nameEn: "Singing Bone", emoji: "🦴" },
  { key: "toy_wand", category: "toy", rarity: "legendary", nameZh: "魔法星辰杖", nameEn: "Magic Star Wand", emoji: "🪄" },
];

/** 稀有度权重（普通 70% / 稀有 25% / 传说 5%，需求红线） */
export const RARITY_WEIGHTS: Record<ItemRarity, number> = {
  common: 0.7,
  rare: 0.25,
  legendary: 0.05,
};

/** 按 key 查目录（未知 key 返回 undefined，客户端需兜底展示） */
export function itemByKey(key: string): CheckinItem | undefined {
  return CHECKIN_ITEMS.find((i) => i.key === key);
}

/** 按 locale 取道具展示名 */
export function itemDisplayName(item: CheckinItem, locale: string): string {
  return locale === "en" ? item.nameEn : item.nameZh;
}

/**
 * 签到盲盒抽取：先按权重 roll 稀有度，再在该稀有度的道具中均匀随机一件。
 * @param rand 稀有度 roll 用的随机数 [0, 1)，默认 Math.random()
 * @param guaranteedRare 月卡保底稀有：roll 出普通时强制升级为稀有
 * @param pickRand 同稀有度内均匀挑选用的随机数 [0, 1)
 */
export function rollCheckinItem(
  rand: number = Math.random(),
  guaranteedRare = false,
  pickRand: number = Math.random(),
): CheckinItem {
  let rarity: ItemRarity;
  if (rand < RARITY_WEIGHTS.common) rarity = "common";
  else if (rand < RARITY_WEIGHTS.common + RARITY_WEIGHTS.rare) rarity = "rare";
  else rarity = "legendary";
  if (guaranteedRare && rarity === "common") rarity = "rare";

  const pool = CHECKIN_ITEMS.filter((i) => i.rarity === rarity);
  return pool[Math.min(pool.length - 1, Math.floor(pickRand * pool.length))];
}

/** 签到心情档位（台词见 messages/<locale>.json 的 checkin 命名空间） */
export type CheckinMood = "day1" | "day3" | "day7" | "dayOther";

/** 连签天数 → 心情档位：1 天 / 3 天 / ≥7 天三档里程碑，其余默认档 */
export function moodKeyFor(streak: number): CheckinMood {
  if (streak >= 7) return "day7";
  if (streak === 3) return "day3";
  if (streak === 1) return "day1";
  return "dayOther";
}

/** 心情 → 宠物表情 emoji（台词旁的表情气泡） */
export const MOOD_EXPRESSIONS: Record<CheckinMood, string> = {
  day1: "😊",
  day3: "🥰",
  day7: "🤩",
  dayOther: "😄",
};

/** 稀有度 → 徽章配色（弹窗开箱动画与背包列表共用） */
export const RARITY_BADGE_CLASS: Record<ItemRarity, string> = {
  common: "bg-zinc-100 text-zinc-600 border-zinc-200",
  rare: "bg-violet-100 text-violet-700 border-violet-300",
  legendary: "bg-amber-100 text-amber-700 border-amber-300",
};

/** 用户背包行（GET /api/user/items 返回；meta 由客户端用目录解析） */
export type UserItemRow = {
  id: string;
  itemKey: string;
  rarity: ItemRarity;
  source: string;
  /** 装备在哪只领养宠物上（NULL = 收纳在背包中） */
  equippedAdoptionId: string | null;
  createdAt: string;
};
