/**
 * 宠物旅行日记 · 探险商城配置（纯常量，零依赖、零副作用）
 *
 * 设计原则：
 *  1) SHOP_ITEMS 是商品目录的真理之源（DB shop_items 是缓存层，runtime 可对比修复）；
 *  2) effectType 与数据库 effect_type 列一一对应；
 *  3) 装备判定：用户已购且 source='shop' 的 user_items 会被视作"已装备"，
 *     探索推进时由 advanceStep 读取 equippedItemKeys[] 决定步数加成 / 事件效果。
 */

export type ShopEffectType =
  | "obstacle_pass" // 自动通过障碍（bridge / rope）
  | "weather_resist" // 免疫天气负面影响（tent / umbrella）
  | "distance_boost" // 步数加成（compass ×1.5）
  | "rare_event" // 稀有事件概率翻倍（lantern）
  | "map_skip"; // 跳过当前地图（hot_air_balloon，本期仅展示文案）

export type ShopItemConfig = {
  /** 唯一 id（与 shop_items.id 一致） */
  id: string;
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
  icon: string;
  price: number;
  currency: "coin" | "rmb" | "subscription";
  effectType: ShopEffectType;
  /** 数值；distance_boost=1.5 → 步数 ×1.5；其他效果通常为 1.0 */
  effectValue: number;
  /** -1 = 永久；>0 = 消耗品秒数（本期仅 -1 入库自动装备） */
  duration: number;
  isPremium: boolean;
  sortOrder: number;
};

export const SHOP_ITEMS: ReadonlyArray<ShopItemConfig> = [
  {
    id: "tent", nameZh: "露营帐篷", nameEn: "Camping Tent",
    descriptionZh: "在野外露营，不受恶劣天气影响",
    descriptionEn: "Camp outdoors, immune to bad weather",
    icon: "⛺", price: 100, currency: "coin",
    effectType: "weather_resist", effectValue: 1.0, duration: -1,
    isPremium: false, sortOrder: 1,
  },
  {
    id: "umbrella", nameZh: "魔法雨伞", nameEn: "Magic Umbrella",
    descriptionZh: "下雨天也能继续探索，不会被淋湿",
    descriptionEn: "Keep exploring in rain without getting wet",
    icon: "☂️", price: 50, currency: "coin",
    effectType: "weather_resist", effectValue: 1.0, duration: -1,
    isPremium: false, sortOrder: 2,
  },
  {
    id: "compass", nameZh: "黄金指南针", nameEn: "Golden Compass",
    descriptionZh: "每次聊天多走 50% 的步数",
    descriptionEn: "Walk 50% more steps per chat message",
    icon: "🧭", price: 200, currency: "coin",
    effectType: "distance_boost", effectValue: 1.5, duration: -1,
    isPremium: false, sortOrder: 3,
  },
  {
    id: "bridge", nameZh: "便携桥梁", nameEn: "Portable Bridge",
    descriptionZh: "自动通过河流障碍，无需等待",
    descriptionEn: "Auto-cross river obstacles instantly",
    icon: "🌉", price: 80, currency: "coin",
    effectType: "obstacle_pass", effectValue: 1.0, duration: -1,
    isPremium: false, sortOrder: 4,
  },
  {
    id: "rope", nameZh: "攀岩绳索", nameEn: "Climbing Rope",
    descriptionZh: "自动通过陡坡障碍，无需等待",
    descriptionEn: "Auto-cross cliff obstacles instantly",
    icon: "🧗", price: 80, currency: "coin",
    effectType: "obstacle_pass", effectValue: 1.0, duration: -1,
    isPremium: false, sortOrder: 5,
  },
  {
    id: "lantern", nameZh: "星空灯笼", nameEn: "Star Lantern",
    descriptionZh: "夜间探索触发稀有事件的概率翻倍",
    descriptionEn: "Double rare event chance during night",
    icon: "🏮", price: 300, currency: "coin",
    effectType: "rare_event", effectValue: 2.0, duration: -1,
    isPremium: true, sortOrder: 6,
  },
  {
    id: "hot_air_balloon", nameZh: "热气球", nameEn: "Hot Air Balloon",
    descriptionZh: "直接跳过当前地图，到达下一区域",
    descriptionEn: "Skip current map, jump to next region",
    icon: "🎈", price: 500, currency: "coin",
    effectType: "map_skip", effectValue: 1.0, duration: -1,
    isPremium: true, sortOrder: 7,
  },
];

export const SHOP_SOURCE = "shop";

/** 按 id 查商品（未知 id 返回 undefined） */
export function shopItemById(id: string): ShopItemConfig | undefined {
  return SHOP_ITEMS.find((i) => i.id === id);
}

/**
 * 按 locale 取展示名（商城卡片 / 购买后 toast 共用）
 */
export function shopItemDisplayName(item: ShopItemConfig, locale: "zh" | "en"): string {
  return locale === "en" ? item.nameEn : item.nameZh;
}

export function shopItemDisplayDescription(item: ShopItemConfig, locale: "zh" | "en"): string {
  return locale === "en" ? item.descriptionEn : item.descriptionZh;
}

/**
 * 装备集合 → 步数倍率。
 *  - compass effectValue=1.5 → 步数 ×1.5；
 *  - 多个 distance_boost 装备取最大值（不叠加，避免指数爆炸）。
 * @returns 步数倍率（默认 1.0）
 */
export function distanceMultiplier(equippedItemKeys: ReadonlyArray<string>): number {
  let mult = 1.0;
  for (const key of equippedItemKeys) {
    const it = shopItemById(key);
    if (it && it.effectType === "distance_boost") {
      if (it.effectValue > mult) mult = it.effectValue;
    }
  }
  return mult;
}

/**
 * 装备集合 → 稀有事件概率倍率（lantern ×2）。
 *  - rare_event 装备的 effectValue 相乘（仅本期有 lantern 1 个，固定 ×2）。
 */
export function rareEventMultiplier(equippedItemKeys: ReadonlyArray<string>): number {
  let mult = 1.0;
  for (const key of equippedItemKeys) {
    const it = shopItemById(key);
    if (it && it.effectType === "rare_event") {
      mult *= it.effectValue;
    }
  }
  return mult;
}

/**
 * 判断 obstacle 事件是否会被装备"自动通过"。
 *  - bridge（河流） / rope（陡坡）都通过 obstacle_pass 装备自动通过。
 *  - 本期"自动通过"只表示标记 event.passedByEquipment = true，事件弹窗文案展示使用效果；
 *    实际步数与 map 进度仍正常推进（不卡关）。
 */
export function canPassObstacle(
  equippedItemKeys: ReadonlyArray<string>,
): boolean {
  for (const key of equippedItemKeys) {
    const it = shopItemById(key);
    if (it && it.effectType === "obstacle_pass") return true;
  }
  return false;
}

/**
 * 判断 weather 事件是否会被装备"免疫"。
 *  - tent / umbrella 通过 weather_resist 装备免疫天气负面影响。
 *  - 本期 weather 事件本身只设置 curWeather（不扣步数），所以 weather_resist 主要用于：
 *    (a) 弹窗文案提示"装备帮你挡雨啦~"；
 *    (b) 后续 P1 可扩展雨天扣步数。
 */
export function canResistWeather(equippedItemKeys: ReadonlyArray<string>): boolean {
  for (const key of equippedItemKeys) {
    const it = shopItemById(key);
    if (it && it.effectType === "weather_resist") return true;
  }
  return false;
}
