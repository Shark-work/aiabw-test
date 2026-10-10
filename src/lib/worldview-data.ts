/**
 * 艾比大陆世界观 · 单一数据源（Single Source of Truth，2026-10-16）
 *
 * 与 aibi-catalog.ts 同模式：
 *  - client.ts 版本闸门自动同步时，经 src/db/worldview-seed.ts 生成 upsert SQL 灌库；
 *  - /world 百科页 / 探索页区域栏 / 图鉴古灵卡可直接 import 本模块静态渲染，无需等接口；
 *  - GET /api/world 查 DB 返回（验证种子落库 + 对外查询接口）。
 *
 * 内容忠实执行《艾比大陆世界观设定文档》（docs/WORLDVIEW_BIBLE.md）：
 *  - 8 大区域（艾比小镇 + 7 探索区域），habitat_id 映射既有 AIBI_HABITATS 五栖息地
 *    （star_mist→mistwood / lava_rift→lavaforge / frost_waste→frostshore /
 *      mech_ruins→mechwaste / cloud_islands→skyisles；town/azure_coast/hourglass_desert 无对应栖息地）；
 *  - 3 种生命形态（凡兽/灵宠/古灵）；5 大信条（共鸣/探索/收藏/羁绊/传承）；6 个核心概念词条。
 */

// ---------- 区域 ----------
export interface WorldRegion {
  id: string;
  nameZh: string;
  nameEn: string;
  typeZh: string;
  typeEn: string;
  /** 地脉属性（如 风+光 / 混沌（全能）） */
  elementZh: string;
  elementEn: string;
  /** 代表灵宠/居民（文档原文） */
  representativesZh: string;
  representativesEn: string;
  descriptionZh: string;
  descriptionEn: string;
  /** 映射既有 AIBI_HABITATS id（无对应则 null） */
  habitatId: string | null;
  /** 卡片展示图标（立绘素材前的占位） */
  emoji: string;
  sortOrder: number;
}

export const WORLD_REGIONS: readonly WorldRegion[] = [
  {
    id: "town",
    nameZh: "艾比小镇",
    nameEn: "Aibi Town",
    typeZh: "中心枢纽",
    typeEn: "Central Hub",
    elementZh: "混沌（全能）",
    elementEn: "Chaos (All)",
    representativesZh: "刺猬、陆龟、企鹅等普通动物",
    representativesEn: "Hedgehogs, tortoises, penguins and other ordinary animals",
    descriptionZh:
      "万界交汇的十字路口，来自各地的旅人在此相遇。小镇中央有一棵巨大的「灵魂树」，它的根须连接着大陆每一寸土地。",
    descriptionEn:
      "A crossroads where all worlds meet, where travelers from every land gather. At the town center stands the great Soul Tree, its roots touching every inch of the continent.",
    habitatId: null,
    emoji: "🏘️",
    sortOrder: 1,
  },
  {
    id: "cloud_islands",
    nameZh: "云端群岛",
    nameEn: "Cloud Isles",
    typeZh: "浮空岛屿群",
    typeEn: "Floating Archipelago",
    elementZh: "风+光",
    elementEn: "Wind + Light",
    representativesZh: "光翼蝶、风灵",
    representativesEn: "Radiantwing Butterfly, Gale Spirit",
    descriptionZh:
      "漂浮在云海之上的破碎岛屿，古代文明遗留的天空遗迹。这里的灵宠天生能感知风的语言。",
    descriptionEn:
      "Shattered isles drifting above a sea of clouds—sky ruins left by an ancient civilization. Soul Pets here are born able to hear the language of the wind.",
    habitatId: "skyisles",
    emoji: "☁️",
    sortOrder: 2,
  },
  {
    id: "lava_rift",
    nameZh: "熔岩裂谷",
    nameEn: "Lava Rift",
    typeZh: "火山地带",
    typeEn: "Volcanic Rift",
    elementZh: "火",
    elementEn: "Fire",
    representativesZh: "炎鳞龙",
    representativesEn: "Pyroscale Dragon",
    descriptionZh:
      "大地裂缝中涌出的熔岩滋养了火系灵宠。裂谷深处沉睡着古代火龙「焰心」的化石。",
    descriptionEn:
      "Lava welling from the earth's cracks nourishes fire-element Soul Pets. Deep in the rift sleeps the fossil of Flameheart, the ancient fire dragon.",
    habitatId: "lavaforge",
    emoji: "🌋",
    sortOrder: 3,
  },
  {
    id: "star_mist",
    nameZh: "星雾森林",
    nameEn: "Starmist Forest",
    typeZh: "迷雾古林",
    typeEn: "Mist-shrouded Ancient Forest",
    elementZh: "光+暗",
    elementEn: "Light + Dark",
    representativesZh: "星灵猫、猫头鹰",
    representativesEn: "Stellar Cat, Owl",
    descriptionZh:
      "终年被星雾笼罩的千年古林，树木上挂着发光的果实。传说森林之心能映照出你内心最渴望的东西。",
    descriptionEn:
      "A thousand-year-old forest veiled in eternal star mist, its trees hung with glowing fruit. Legend says the Heart of the Forest mirrors the thing you desire most.",
    habitatId: "mistwood",
    emoji: "🌲",
    sortOrder: 4,
  },
  {
    id: "mech_ruins",
    nameZh: "机械废都",
    nameEn: "Mech Ruins",
    typeZh: "遗迹废墟",
    typeEn: "Ancient Ruins",
    elementZh: "雷+钢",
    elementEn: "Thunder + Steel",
    representativesZh: "钢甲兽",
    representativesEn: "Steelplate Beast",
    descriptionZh:
      "上古文明留下的钢铁之城，如今被雷暴笼罩。废弃的机械中偶尔会「觉醒」出带有灵魂的构造体。",
    descriptionEn:
      "A steel city left by an ancient civilization, now wrapped in thunderstorms. Among the abandoned machines, constructs with souls occasionally awaken.",
    habitatId: "mechwaste",
    emoji: "🏭",
    sortOrder: 5,
  },
  {
    id: "azure_coast",
    nameZh: "蔚蓝海岸",
    nameEn: "Azure Coast",
    typeZh: "海洋区域",
    typeEn: "Ocean Realm",
    elementZh: "水",
    elementEn: "Water",
    representativesZh: "海獭、蓝鲸",
    representativesEn: "Sea Otter, Blue Whale",
    descriptionZh:
      "大陆边缘的广阔海域，海底沉没着古代亚特兰蒂斯遗迹。海獭是这里最机灵的居民，蓝鲸则是海域的守护者。",
    descriptionEn:
      "Vast waters at the continent's edge, with the ruins of ancient Atlantis sunk beneath. Sea otters are the cleverest residents; the blue whale is guardian of the realm.",
    habitatId: null,
    emoji: "🌊",
    sortOrder: 6,
  },
  {
    id: "frost_waste",
    nameZh: "霜语荒原",
    nameEn: "Frostwhisper Wastes",
    typeZh: "冰原区域",
    typeEn: "Frozen Wasteland",
    elementZh: "冰+暗",
    elementEn: "Ice + Dark",
    representativesZh: "北极熊、雪豹",
    representativesEn: "Polar Bear, Snow Leopard",
    descriptionZh:
      "终年积雪的北方荒原，极光常年悬挂天际。荒原深处的冰洞里封存着世界最初的记忆。",
    descriptionEn:
      "A snowbound northern wasteland beneath a permanent aurora. In ice caves deep within, the world's very first memories are sealed away.",
    habitatId: "frostshore",
    emoji: "❄️",
    sortOrder: 7,
  },
  {
    id: "hourglass_desert",
    nameZh: "沙漏沙漠",
    nameEn: "Hourglass Desert",
    typeZh: "沙漠区域",
    typeEn: "Desert Realm",
    elementZh: "火+土",
    elementEn: "Fire + Earth",
    representativesZh: "猎豹、骆驼",
    representativesEn: "Cheetah, Camel",
    descriptionZh:
      "被时间遗忘的金色沙漠，沙粒中藏着古代文明的碎片。沙漠之眼是一座永不干涸的绿洲。",
    descriptionEn:
      "A golden desert forgotten by time, its sands hiding fragments of ancient civilizations. The Eye of the Desert is an oasis that never runs dry.",
    habitatId: null,
    emoji: "🏜️",
    sortOrder: 8,
  },
];


// ---------- 生命形态（凡兽 / 灵宠 / 古灵） ----------
export interface WorldLifeForm {
  id: string;
  nameZh: string;
  nameEn: string;
  titleZh: string;
  titleEn: string;
  descriptionZh: string;
  descriptionEn: string;
  examplesZh: string;
  examplesEn: string;
  emoji: string;
  sortOrder: number;
}

export const WORLD_LIFE_FORMS: readonly WorldLifeForm[] = [
  {
    id: "mortal",
    nameZh: "凡兽",
    nameEn: "Mortal Beast",
    titleZh: "普通动物",
    titleEn: "Ordinary Animal",
    descriptionZh:
      "没有地脉能量的普通生物，生活在小镇和各个区域边缘。温顺、平凡，是旅人最初的伙伴。",
    descriptionEn:
      "Ordinary creatures without leyline energy, living in town and at the edges of each region. Gentle and humble, they are a traveler's first companions.",
    examplesZh: "刺猬、陆龟、企鹅、波斯猫",
    examplesEn: "Hedgehog, Tortoise, Penguin, Persian Cat",
    emoji: "🐾",
    sortOrder: 1,
  },
  {
    id: "spirit",
    nameZh: "灵宠",
    nameEn: "Soul Pet",
    titleZh: "灵魂共鸣兽",
    titleEn: "Soul-Resonant Beast",
    descriptionZh:
      "吸收了地脉能量「灵魂碎片」而觉醒的凡兽，获得特殊能力和智慧。每种灵宠对应一种元素和性格。",
    descriptionEn:
      "Mortal beasts awakened by absorbing leyline energy—Soul Fragments—gaining special powers and wisdom. Each Soul Pet corresponds to an element and a personality.",
    examplesZh: "炎鳞龙(火)、光翼蝶(光)、风灵(风)、钢甲兽(雷)",
    examplesEn:
      "Pyroscale Dragon (Fire), Radiantwing Butterfly (Light), Gale Spirit (Wind), Steelplate Beast (Thunder)",
    emoji: "✨",
    sortOrder: 2,
  },
  {
    id: "ancient",
    nameZh: "古灵",
    nameEn: "Ancient Spirit",
    titleZh: "传说守护兽",
    titleEn: "Legendary Guardian",
    descriptionZh:
      "大陆各区域的远古守护者，传说级别的存在。它们不是被「唤醒」的，而是世界本身意志的化身。",
    descriptionEn:
      "The primordial guardians of each region—beings of legend. They are not awakened by anyone; they are the embodiment of the world's own will.",
    examplesZh: "焰心(火龙)、云脊(风龙)、星瞳(猫神)",
    examplesEn: "Flameheart (Fire Dragon), Cloudspine (Wind Dragon), Starpupil (Cat Deity)",
    emoji: "🐉",
    sortOrder: 3,
  },
];

/** 生命形态 id → 显示名（详情页标签等复用） */
export type WorldLifeFormId = (typeof WORLD_LIFE_FORMS)[number]["id"];

/**
 * 图鉴物种的生命形态判定：AIBI 目录物种（炎鳞龙等 12 种）为灵宠，其余凡兽；
 * 古灵为传说存在，暂无可领养物种（图鉴筛选项保留 + 「尚未苏醒」空态）。
 */
export function lifeFormOfSpecies(speciesId: string, aibiSpeciesIds: ReadonlySet<string>): WorldLifeFormId {
  return aibiSpeciesIds.has(speciesId) ? "spirit" : "mortal";
}

// ---------- 古灵个体（传说守护兽 ×3；文档 §3 动物观） ----------
/** 古灵不可被唤醒/领养——它们是世界本身意志的化身（图鉴「古灵」筛选的沉睡展示卡）。 */
export interface WorldAncient {
  id: string;
  nameZh: string;
  nameEn: string;
  titleZh: string;
  titleEn: string;
  /** 关联区域（lore：lava_rift 描述提及焰心化石；其余为区域守护者归属） */
  regionId: string;
  emoji: string;
}

export const WORLD_ANCIENTS: readonly WorldAncient[] = [
  { id: "flameheart", nameZh: "焰心", nameEn: "Flameheart", titleZh: "火龙", titleEn: "Fire Dragon", regionId: "lava_rift", emoji: "🔥" },
  { id: "cloudspine", nameZh: "云脊", nameEn: "Cloudspine", titleZh: "风龙", titleEn: "Wind Dragon", regionId: "cloud_islands", emoji: "🌪️" },
  { id: "starpupil", nameZh: "星瞳", nameEn: "Starpupil", titleZh: "猫神", titleEn: "Cat Deity", regionId: "star_mist", emoji: "🌟" },
];


// ---------- 五大信条 ----------
export interface WorldValue {
  id: string;
  nameZh: string;
  nameEn: string;
  /** 信条标语（文档原文引言） */
  sloganZh: string;
  sloganEn: string;
  /** 对应玩法说明 */
  featureZh: string;
  featureEn: string;
  emoji: string;
  sortOrder: number;
}

export const WORLD_VALUES: readonly WorldValue[] = [
  {
    id: "resonance",
    nameZh: "共鸣",
    nameEn: "Resonance",
    sloganZh: "真正的伙伴不需要语言，一个眼神就懂彼此。",
    sloganEn: "A true companion needs no words—one glance says everything.",
    featureZh: "养成、聊天互动、幸福度玩法",
    featureEn: "Raising, chat interaction & happiness gameplay",
    emoji: "💞",
    sortOrder: 1,
  },
  {
    id: "explore",
    nameZh: "探索",
    nameEn: "Exploration",
    sloganZh: "世界比你能想象的更大，每一步都是新的奇迹。",
    sloganEn: "The world is bigger than you can imagine; every step is a new miracle.",
    featureZh: "探索玩法、明信片收集",
    featureEn: "Exploration gameplay & postcard collection",
    emoji: "🧭",
    sortOrder: 2,
  },
  {
    id: "collect",
    nameZh: "收藏",
    nameEn: "Collection",
    sloganZh: "每一只灵宠都是独一无二的存在，值得被铭记。",
    sloganEn: "Every Soul Pet is one of a kind, and deserves to be remembered.",
    featureZh: "灵魂卡收集、图鉴完成",
    featureEn: "Soul Card collection & codex completion",
    emoji: "🃏",
    sortOrder: 3,
  },
  {
    id: "bond",
    nameZh: "羁绊",
    nameEn: "Bond",
    sloganZh: "独行的灵宠走不远，结伴的灵宠能创造奇迹。",
    sloganEn: "A lone Soul Pet travels no far road; together, Soul Pets work miracles.",
    featureZh: "羁绊结晶、灵宠配对",
    featureEn: "Bond Crystals & Soul Pet pairing",
    emoji: "🔗",
    sortOrder: 4,
  },
  {
    id: "legacy",
    nameZh: "传承",
    nameEn: "Legacy",
    sloganZh: "你的冒险不会被遗忘，它会成为下一个旅人的灯塔。",
    sloganEn: "Your adventure will not be forgotten—it becomes the lighthouse for the next traveler.",
    featureZh: "分享图、公开页、明信片墙",
    featureEn: "Share images, public pages & the postcard wall",
    emoji: "🕯️",
    sortOrder: 5,
  },
];

// ---------- 核心概念辞典 ----------
export interface WorldGlossaryEntry {
  id: string;
  termZh: string;
  termEn: string;
  definitionZh: string;
  definitionEn: string;
  emoji: string;
  sortOrder: number;
}

export const WORLD_GLOSSARY: readonly WorldGlossaryEntry[] = [
  {
    id: "soul-seed",
    termZh: "灵魂种子",
    termEn: "Soul Seed",
    definitionZh: "创世碎片，赋予凡兽觉醒为灵宠的潜能。每次「唤醒」都是种子与旅人灵魂共鸣的结果。",
    definitionEn:
      "A fragment of creation, granting mortal beasts the potential to awaken as Soul Pets. Every Awakening is the result of resonance between the seed and a traveler's soul.",
    emoji: "🌱",
    sortOrder: 1,
  },
  {
    id: "soul-card",
    termZh: "灵魂卡",
    termEn: "Soul Card",
    definitionZh:
      "灵宠灵魂的「镜像」——当灵宠与你共鸣时，它的灵魂会在卡片上留下印记。卡面会随灵宠成长而变化。",
    definitionEn:
      "A mirror of a Soul Pet's soul—when it resonates with you, its soul leaves an imprint upon the card. The card face changes as the Soul Pet grows.",
    emoji: "🃏",
    sortOrder: 2,
  },
  {
    id: "leyline",
    termZh: "地脉能量",
    termEn: "Leyline Energy",
    definitionZh: "大陆各处流动的能量源，不同区域有不同属性。灵宠的力量来源于此。",
    definitionEn:
      "Energy flowing through every corner of the continent; each region carries a different attribute. It is the source of every Soul Pet's power.",
    emoji: "🌐",
    sortOrder: 3,
  },
  {
    id: "bond-crystal",
    termZh: "羁绊结晶",
    termEn: "Bond Crystal",
    definitionZh: "两只灵宠深度共鸣后，灵魂碎片融合凝结成的晶体——是「羁绊」的物质化证明。",
    definitionEn:
      "A crystal formed when two Soul Pets resonate deeply and their Soul Fragments fuse—material proof of a Bond.",
    emoji: "💎",
    sortOrder: 4,
  },
  {
    id: "postcard",
    termZh: "明信片",
    termEn: "Postcard",
    definitionZh: "探索各地时自然形成的「风景灵魂碎片」，记录了你到过的每一个地方。",
    definitionEn:
      "Scenic Soul Fragments that form naturally while exploring—recording every place you have been.",
    emoji: "💌",
    sortOrder: 5,
  },
  {
    id: "soul-tree",
    termZh: "灵魂树",
    termEn: "Soul Tree",
    definitionZh: "位于艾比小镇中心的神秘大树，连接大陆所有地脉。它是所有灵宠的「故乡」。",
    definitionEn:
      "The mysterious great tree at the center of Aibi Town, connecting every leyline on the continent. It is the homeland of all Soul Pets.",
    emoji: "🌳",
    sortOrder: 6,
  },
];

