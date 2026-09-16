/**
 * 宠物旅行日记 · 探索系统配置（纯常量，零依赖、零副作用）
 *
 * 设计原则：
 *  1) 地图分段：7 段，每段 100 步，共 700 步一轮；完成后自动进入下一段 + 生成明信片。
 *  2) 事件抽取：应用层从此处的 MAP_EVENT_SEEDS 中按 map_id 过滤 + 随机抽一条。
 *     DB 端 map_events 表为可选缓存（首次冷启动时由 API route 写入种子）。
 *  3) 道具 / 物品：复用现有 user_items 表（item_key 关联），source='exploration'。
 *  4) 天气：影响后续事件概率（如 rainy → weather_bias='rainy' 事件触发率 +50%）。
 *  5) 步数驱动：每条用户消息推进 STEPS_PER_MESSAGE 步（默认 10），由
 *     /api/exploration/step 在聊天回复完成后调用。
 */

export type Weather = "sunny" | "rainy" | "snowy" | "cloudy";
export type EventType = "item" | "weather" | "npc" | "obstacle";
export type MapInfo = {
  id: number;
  i18nNameKey: string;
  emoji: string;
  gradient: string;
  defaultWeather: Weather;
};

export const EXPLORATION_MAPS: ReadonlyArray<MapInfo> = [
  { id: 1, i18nNameKey: "map1", emoji: "🏘️",
    gradient: "linear-gradient(180deg,#fde68a 0%,#bef264 60%,#86efac 100%)",
    defaultWeather: "sunny" },
  { id: 2, i18nNameKey: "map2", emoji: "🌾",
    gradient: "linear-gradient(180deg,#fef3c7 0%,#bbf7d0 60%,#86efac 100%)",
    defaultWeather: "sunny" },
  { id: 3, i18nNameKey: "map3", emoji: "🌲",
    gradient: "linear-gradient(180deg,#bbf7d0 0%,#86efac 50%,#15803d 100%)",
    defaultWeather: "cloudy" },
  { id: 4, i18nNameKey: "map4", emoji: "🌊",
    gradient: "linear-gradient(180deg,#7dd3fc 0%,#38bdf8 50%,#0369a1 100%)",
    defaultWeather: "rainy" },
  { id: 5, i18nNameKey: "map5", emoji: "🏜️",
    gradient: "linear-gradient(180deg,#fed7aa 0%,#fdba74 50%,#c2410c 100%)",
    defaultWeather: "sunny" },
  { id: 6, i18nNameKey: "map6", emoji: "🏔️",
    gradient: "linear-gradient(180deg,#e0f2fe 0%,#f1f5f9 50%,#94a3b8 100%)",
    defaultWeather: "snowy" },
  { id: 7, i18nNameKey: "map7", emoji: "🌌",
    gradient: "linear-gradient(180deg,#1e1b4b 0%,#312e81 60%,#7c3aed 100%)",
    defaultWeather: "cloudy" },
];

export const STEPS_PER_MESSAGE = 10;
export const STEPS_PER_MAP = 100;
export const TOTAL_STEPS = STEPS_PER_MAP * EXPLORATION_MAPS.length;
export const EVENT_BASE_PROBABILITY = 0.6;
export const EVENT_CHECK_MIN = 15;
export const EVENT_CHECK_MAX = 25;

export type ExplorationItem = {
  key: string;
  nameZh: string;
  nameEn: string;
  emoji: string;
  rarity: "common" | "rare" | "epic" | "legendary";
};

export const EXPLORATION_ITEMS: ReadonlyArray<ExplorationItem> = [
  { key: "tent", nameZh: "小帐篷", nameEn: "Cozy Tent", emoji: "⛺", rarity: "common" },
  { key: "umbrella", nameZh: "小伞", nameEn: "Tiny Umbrella", emoji: "🌂", rarity: "common" },
  { key: "compass", nameZh: "指南针", nameEn: "Compass", emoji: "🧭", rarity: "rare" },
  { key: "feather", nameZh: "神秘羽毛", nameEn: "Mystic Feather", emoji: "🪶", rarity: "epic" },
  { key: "bridge", nameZh: "小木桥", nameEn: "Wooden Bridge", emoji: "🌉", rarity: "rare" },
  { key: "rope", nameZh: "绳索", nameEn: "Rope", emoji: "🪢", rarity: "common" },
];

export type MapEventSeed = {
  mapId: number;
  eventType: EventType;
  titleZh: string;
  titleEn: string;
  descriptionZh: string;
  descriptionEn: string;
  rewardItemKey?: string;
  probability?: number;
  weatherBias?: Weather | null;
};

export const MAP_EVENT_SEEDS: ReadonlyArray<MapEventSeed> = [
  { mapId: 1, eventType: "item", titleZh: "邻居的礼物", titleEn: "Neighbor's Gift",
    descriptionZh: "村庄里的老婆婆送了你一根【{item}】，说是祝你好运~", descriptionEn: "The village granny gave you a {item} as a lucky charm~",
    rewardItemKey: "feather", probability: 0.6 },
  { mapId: 1, eventType: "npc", titleZh: "路上遇到抱抱狐", titleEn: "Met a friendly fox",
    descriptionZh: "一只小狐狸朝你摇了摇尾巴，仿佛在说『加油！』", descriptionEn: "A little fox wagged its tail at you, as if saying 'go go go!'",
    probability: 0.6 },
  { mapId: 1, eventType: "obstacle", titleZh: "小水坑", titleEn: "Puddle",
    descriptionZh: "前面有个小水坑，小心别弄湿爪子！退回几步绕路…", descriptionEn: "A small puddle ahead - step back and find another way…",
    probability: 0.4 },
  { mapId: 2, eventType: "item", titleZh: "草丛里的宝贝", titleEn: "Treasure in the grass",
    descriptionZh: "拨开草丛发现了一个【{item}】！", descriptionEn: "Pushed aside the grass and found a {item}!",
    rewardItemKey: "umbrella", probability: 0.5 },
  { mapId: 2, eventType: "weather", titleZh: "天气放晴", titleEn: "Clearing up",
    descriptionZh: "云层散去，阳光洒满大地，心情也跟着好起来~", descriptionEn: "Clouds part and sunlight bathes the land - the mood lifts~",
    probability: 0.6, weatherBias: "sunny" },
  { mapId: 2, eventType: "npc", titleZh: "蝴蝶绕着你飞", titleEn: "Butterflies around you",
    descriptionZh: "几只彩色蝴蝶绕着你转圈，像是欢迎远道而来的客人。", descriptionEn: "A few colorful butterflies dance around you - welcoming the traveler.",
    probability: 0.6 },
  { mapId: 3, eventType: "item", titleZh: "树洞里的小收藏", titleEn: "Tree hole treasure",
    descriptionZh: "在一棵老树的树洞里发现了【{item}】！", descriptionEn: "Inside a hollow tree, you find a {item}!",
    rewardItemKey: "compass", probability: 0.5 },
  { mapId: 3, eventType: "obstacle", titleZh: "挡路的藤蔓", titleEn: "Tangled vines",
    descriptionZh: "密林中的藤蔓挡住了去路，原地转了几圈…", descriptionEn: "Vines block the path - turn around and find a detour…",
    probability: 0.4 },
  { mapId: 3, eventType: "npc", titleZh: "林中小猫", titleEn: "Forest kitten",
    descriptionZh: "一只小猫从树后探出头来，和你打了个照面。", descriptionEn: "A kitten peeks from behind a tree and glances at you.",
    probability: 0.6 },
  { mapId: 4, eventType: "obstacle", titleZh: "挡路的河流", titleEn: "River blocking the way",
    descriptionZh: "前面是湍急的河水，没有桥怎么办？退回几步找路…", descriptionEn: "A swift river blocks the way - back up a few steps and look for a way around…",
    probability: 0.6, weatherBias: "rainy" },
  { mapId: 4, eventType: "item", titleZh: "河边漂浮的箱子", titleEn: "Drifting box",
    descriptionZh: "河水冲来一个小木箱，里面是一把【{item}】！", descriptionEn: "A small box drifts in - inside is a {item}!",
    rewardItemKey: "bridge", probability: 0.5, weatherBias: "rainy" },
  { mapId: 4, eventType: "weather", titleZh: "下起小雨", titleEn: "Light rain",
    descriptionZh: "天上飘起了毛毛细雨，空气里弥漫着泥土的清香。", descriptionEn: "A light drizzle falls - the air smells of fresh earth.",
    probability: 0.6, weatherBias: "rainy" },
  { mapId: 5, eventType: "item", titleZh: "沙丘下的宝贝", titleEn: "Buried treasure",
    descriptionZh: "在沙丘下刨出了一个【{item}】，太走运了！", descriptionEn: "Dug up a {item} from the dune - lucky!",
    rewardItemKey: "tent", probability: 0.5 },
  { mapId: 5, eventType: "obstacle", titleZh: "流沙", titleEn: "Quicksand",
    descriptionZh: "前方一片流沙！赶紧退回几步！", descriptionEn: "Quicksand ahead! Quickly back up a few steps!",
    probability: 0.5 },
  { mapId: 5, eventType: "npc", titleZh: "沙漠之舟", titleEn: "Desert companion",
    descriptionZh: "一只小骆驼远远地看着你，鼻子哼了一声。", descriptionEn: "A small camel watches from afar, humming softly.",
    probability: 0.6 },
  { mapId: 6, eventType: "weather", titleZh: "雪花飘落", titleEn: "Snowflakes",
    descriptionZh: "天空中飘起晶莹的雪花，世界一下子安静下来。", descriptionEn: "Crystal snowflakes drift down - the world goes quiet.",
    probability: 0.6, weatherBias: "snowy" },
  { mapId: 6, eventType: "obstacle", titleZh: "陡坡", titleEn: "Steep slope",
    descriptionZh: "前面是个陡坡，没有绳索很难爬——退回几步找路。", descriptionEn: "A steep slope blocks the way - retreat and find another route.",
    probability: 0.5 },
  { mapId: 6, eventType: "item", titleZh: "雪地里的反射光", titleEn: "Gleam in the snow",
    descriptionZh: "雪地里有东西在反光，挖出来是一根【{item}】！", descriptionEn: "Something glints in the snow - you dig out a {item}!",
    rewardItemKey: "rope", probability: 0.5, weatherBias: "snowy" },
  { mapId: 7, eventType: "npc", titleZh: "流星划过", titleEn: "Shooting star",
    descriptionZh: "一颗流星划过天际，你默默许了个愿。", descriptionEn: "A shooting star streaks across the sky - you make a quiet wish.",
    probability: 0.7 },
  { mapId: 7, eventType: "item", titleZh: "星尘凝结", titleEn: "Stardust",
    descriptionZh: "星空中飘落的星尘凝结成了【{item}】——旅程的最高奖赏！", descriptionEn: "Falling stardust crystallizes into a {item} - the journey's top reward!",
    rewardItemKey: "feather", probability: 0.5 },
  { mapId: 7, eventType: "weather", titleZh: "极光出现", titleEn: "Aurora appears",
    descriptionZh: "极光在夜空中亮起，旅程即将抵达终点~", descriptionEn: "The aurora lights up the sky - the journey nears its end~",
    probability: 0.7 },
];

export const WEATHER_SET: ReadonlySet<Weather> = new Set<Weather>(["sunny", "rainy", "snowy", "cloudy"]);
export const EXPLORATION_SOURCE = "exploration";

export function rollEventCheckInterval(randomSource: number): number {
  const r = Math.max(0, Math.min(1, randomSource));
  return EVENT_CHECK_MIN + Math.floor(r * (EVENT_CHECK_MAX - EVENT_CHECK_MIN + 1));
}

export function shouldTriggerEvent(randomSource: number, currentWeather: Weather, bias?: Weather | null): boolean {
  const r = Math.max(0, Math.min(1, randomSource));
  let p = EVENT_BASE_PROBABILITY;
  if (bias && bias === currentWeather) p += 0.2;
  return r < p;
}

export function pickEventForMap(
  mapId: number,
  randomSource: number,
  currentWeather: Weather,
): MapEventSeed | null {
  const pool = MAP_EVENT_SEEDS.filter((e) => e.mapId === mapId);
  if (pool.length === 0) return null;
  const r = Math.max(0, Math.min(0.999999, randomSource));
  const candidate = pool[Math.floor(r * pool.length)];
  if (!shouldTriggerEvent(r, currentWeather, candidate.weatherBias)) return null;
  return candidate;
}

export function progressToRatio(progress: number): number {
  return Math.max(0, Math.min(1, progress / STEPS_PER_MAP));
}

export function advanceStep(state: {
  currentMapId: number;
  mapProgress: number;
}): { currentMapId: number; mapProgress: number; completedMapId?: number } {
  const next = state.mapProgress + 1;
  // 进度从 0..99；到达 100 时本步完成整张地图 → 切下一段。
  // 语义：本步走完后进度还没到 100 时保持原 map，进度到 100 即完成。
  if (next <= STEPS_PER_MAP) {
    return { currentMapId: state.currentMapId, mapProgress: next };
  }
  // 已超过一张地图（理论上不会发生，但兜底：跨到下一段）
  const finishedMapId = state.currentMapId;
  const isFinalMap = finishedMapId >= EXPLORATION_MAPS.length;
  const nextMapId = isFinalMap ? 1 : finishedMapId + 1;
  return { currentMapId: nextMapId, mapProgress: 0, completedMapId: finishedMapId };
}

/**
 * 装备层叠的"实际步数"。
 *  - baseSteps = STEPS_PER_MESSAGE（默认 10）；
 *  - distance_boost 装备（如 compass ×1.5）按倍率放大，向下取整。
 *  - 纯函数，advanceStep 调用方在循环内使用。
 * @param baseSteps 基础步数（不含装备）
 * @param equippedItemKeys 用户当前已装备的 itemKey 列表
 * @returns 实际推进的步数（≥ baseSteps）
 */
export function applyEquipmentToSteps(
  baseSteps: number,
  equippedItemKeys: ReadonlyArray<string>,
): number {
  if (equippedItemKeys.length === 0) return baseSteps;
  // 内联实现：避免循环依赖 shop-config（exploration-config 是更底层的纯模块）
  let mult = 1.0;
  for (const key of equippedItemKeys) {
    if (key === "compass") {
      // compass 步数加成 1.5
      if (mult < 1.5) mult = 1.5;
    }
    // 未来可扩展其它 distance_boost 装备
  }
  return Math.max(baseSteps, Math.floor(baseSteps * mult));
}

export function getMapInfo(mapId: number): MapInfo | null {
  return EXPLORATION_MAPS.find((m) => m.id === mapId) ?? null;
}

export function fillItemPlaceholder(
  template: string,
  itemKey: string | null,
  locale: "zh" | "en",
): string {
  if (!itemKey) return template;
  const item = EXPLORATION_ITEMS.find((i) => i.key === itemKey);
  if (!item) return template;
  const name = locale === "en" ? item.nameEn : item.nameZh;
  return template.replace(/\{item\}/g, `${item.emoji} ${name}`);
}
