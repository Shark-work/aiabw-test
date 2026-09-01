/**
 * 动物世界头条（Animal News）核心逻辑：
 *  - 热度算法：score = 互动量 / (年龄小时 + 2) ^ 1.5 —— 点击/点赞/评论加权，时间衰减，
 *    保证最新最火的事件排在最前；
 *  - 敏感词过滤：采集层屏蔽违规/敏感内容；
 *  - 内存缓存（TTL 60s）：避免 /api/news/hot 每次轮播都查库（生产可替换为 Redis/Upstash）；
 *  - 种子内容池：抓取源不可达时的兜底内容（保证模块始终有内容展示）。
 */

export type HotNews = {
  id: number;
  source: string;
  title: string;
  desc: string | null;
  cover: string | null;
  hot: number;
  timestamp: number;
  url: string | null;
  /** 国内/国际（80/20 配比 + 前端国旗标签） */
  isDomestic: boolean;
};

/** 热度计算：baseInteractions = 点赞*1 + 评论*3 + 分享*2（可扩展点击量）。 */
export function computeHotScore(baseInteractions: number, publishedAtMs: number, nowMs: number = Date.now()): number {
  const ageHours = Math.max(0, (nowMs - publishedAtMs) / 3_600_000);
  return baseInteractions / Math.pow(ageHours + 2, 1.5);
}

/** 敏感词 / 违规内容过滤（采集层屏蔽，命中即丢弃）。 */
const BLOCKED_KEYWORDS = [
  "政治",
  "领导",
  "军火",
  "赌博",
  "色情",
  "毒品",
  "疫情死亡",
  "暴力事件",
  "恐怖",
  "vulgar",
  "nsfw",
  "politics",
  "weapon",
  "gambling",
  "porn",
  "drug",
];

export function isBlockedContent(title: string, desc = ""): boolean {
  const text = `${title} ${desc}`.toLowerCase();
  return BLOCKED_KEYWORDS.some((k) => text.includes(k));
}

/** 真实动物关键词（采集层命中才收录：动物救助/保护/动物园/野生动物等）。 */
const ANIMAL_KEYWORDS_REAL = [
  "animal",
  "animals",
  "dog",
  "cat",
  "panda",
  "puppy",
  "kitten",
  "pet",
  "wildlife",
  "dolphin",
  "elephant",
  "tiger",
  "penguin",
  "koala",
  "hamster",
  "rabbit",
  "bird",
  "动物",
  "宠物",
  "熊猫",
  "狗狗",
  "猫咪",
  "野生动物",
  "流浪",
  "宠物救助",
  "动物救助",
  "流浪救助",
  "救助站",
  "领养",
  "猫",
  "狗",
  "动物园",
  "大熊猫",
  "小熊猫",
  "海豚",
  "考拉",
  "企鹅",
  "狼",
  "熊",
  "大象",
  "老虎",
  "金丝猴",
  "鸟类",
  "海洋生物",
  "鳄鱼",
  "蛇",
  "蜥蜴",
  "鹦鹉",
  "仓鼠",
  "龙猫",
  "刺猬",
];

/** 泛动物文化关键词（动漫/电影/纪录片/游戏/科普等 OR 匹配）。 */
const ANIMAL_KEYWORDS_CULTURE = [
  // 动漫 / 电影
  "zootopia",
  "疯狂动物城",
  "lion king",
  "狮子王",
  "kung fu panda",
  "功夫熊猫",
  "tom and jerry",
  "猫和老鼠",
  "ice age",
  "冰河世纪",
  "finding nemo",
  "海底总动员",
  "shark tale",
  "马达加斯加",
  "madagascar",
  "bears",
  "熊出没",
  "paw patrol",
  "汪汪队",
  "bluey",
  "小猪佩奇",
  "peppa pig",
  "动物电影",
  "动物动画",
  "宠物电影",
  "忠犬八公",
  "一条狗的使命",
  // 纪录片 / 综艺
  "动物世界",
  "人与自然",
  "荒野求生",
  "man vs wild",
  "蓝色星球",
  "blue planet",
  "地球脉动",
  "planet earth",
  "动物纪录片",
  "自然纪录片",
  "动物星球",
  // 游戏 / IP
  "pokemon",
  "精灵宝可梦",
  "神奇宝贝",
  "宠物小精灵",
  "皮卡丘",
  "pikachu",
  "animal crossing",
  "动物森友会",
  "stardew",
  "digital pet",
  "电子宠物",
  "数码宝贝",
  "digimon",
  "tomagotchi",
  "拓麻歌子",
  // 科普 / 文化
  "动物冷知识",
  "动物摄影",
  "动物表情包",
  "动物行为",
  "dinosaur",
  "恐龙",
  "古生物",
  "昆虫",
  "蝴蝶",
  "蜜蜂",
  "鲸",
  "章鱼",
  "水母",
  "企鹅科普",
];

/** 泛动物文化（含真实动物）→ OR 逻辑：任一命中即收录。 */
export function isAnimalRelated(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    ANIMAL_KEYWORDS_REAL.some((k) => lower.includes(k)) ||
    ANIMAL_KEYWORDS_CULTURE.some((k) => lower.includes(k))
  );
}

/** 内存缓存（TTL 60s；生产多实例可换 Redis/Upstash，接口签名不变）。 */
const cache = new Map<string, { value: HotNews[]; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

/** 从请求解析新闻语言：?locale= 显式参数优先，否则 NEXT_LOCALE Cookie，默认 zh。 */
export function resolveNewsLocale(req: Request): "zh" | "en" {
  try {
    const q = new URL(req.url).searchParams.get("locale");
    if (q === "en" || q === "zh") return q;
  } catch {
    // 忽略 URL 解析异常
  }
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)NEXT_LOCALE=(zh|en)/);
  return m ? (m[1] as "zh" | "en") : "zh";
}

/** 热度格式化：≥10000 显示 x.xw，≥100 取整，<100 保留一位小数。 */
export function formatHot(hot: number): string {
  if (hot >= 10000) return (hot / 10000).toFixed(1) + "w";
  if (hot >= 100) return String(Math.round(hot));
  return hot.toFixed(1);
}

export function newsCacheGet(key: string): HotNews[] | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    cache.delete(key);
    return null;
  }
  return e.value;
}

export function newsCacheSet(key: string, value: HotNews[]): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** 种子内容池：抓取源不可达时兜底（15 条：8 真实动物 + 4 泛动物文化 + 3 科普）。 */
export const SEED_NEWS: Omit<HotNews, "id" | "hot" | "isDomestic">[] = [
  // ---- 真实动物（8）----
  {
    source: "Seed · 动物头条",
    title: "全球首只成功佩戴卫星项圈的野生大熊猫，追踪数据突破 1 万公里",
    desc: "科研团队通过卫星追踪大熊猫迁徙路线，为栖息地保护提供全新数据支持。",
    cover: null,
    timestamp: Date.now() - 3 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "北京志愿者组建流浪猫救助站，一个月帮 200 只流浪猫找到新家",
    desc: "爱心志愿者轮班照料，绝育、驱虫、领养一条龙，让更多流浪猫告别街头。",
    cover: null,
    timestamp: Date.now() - 5 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "上海野生动物园大熊猫双胞胎满月，线上征名活动火爆",
    desc: "双胞胎滚滚首次亮相，网友投稿的“团团”“圆圆”等名字热度飙升。",
    cover: null,
    timestamp: Date.now() - 7 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "云南亚洲象群持续北上迁徙，沿途村民自发投喂菠萝香蕉",
    desc: "护林员与村民为象群让路，这一“象往”之旅成为人与自然和谐的生动注脚。",
    cover: null,
    timestamp: Date.now() - 11 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "英国一所猫咖的橘猫凭借“营业 12 年”获得社区终身荣誉居民",
    desc: "每天准时上班、陪客人拍照，这只橘猫成了街区最受欢迎的“店长”。",
    cover: null,
    timestamp: Date.now() - 15 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "科学家发现座头鲸会“教学”：幼鲸跟随母亲学习捕食技巧",
    desc: "水下影像记录显示，座头鲸母亲会示范气泡网捕食法，幼鲸反复练习。",
    cover: null,
    timestamp: Date.now() - 20 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "成都大熊猫繁育基地迎来今年第 20 只新生熊猫宝宝",
    desc: "饲养员晒出熊猫宝宝“团子”睡姿，网友直呼可爱暴击。",
    cover: null,
    timestamp: Date.now() - 26 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "澳大利亚考拉救护中心救助 300 只山火幸存考拉，创下纪录",
    desc: "志愿者团队 24 小时轮班喂养与康复，让更多考拉重返野外。",
    cover: null,
    timestamp: Date.now() - 40 * 3_600_000,
    url: null,
  },
  // ---- 泛动物文化（4）----
  {
    source: "Seed · 动物头条",
    title: "《疯狂动物城2》官宣定档，树懒闪电回归引爆全网期待",
    desc: "新反派与更广阔的动物都市图景曝光，粉丝直呼“等太久了”。",
    cover: null,
    timestamp: Date.now() - 9 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "《狮子王：木法沙传奇》发布新预告，草原生命故事延续",
    desc: "荣耀大地的起源传说揭开面纱，经典旋律再度响起。",
    cover: null,
    timestamp: Date.now() - 18 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "《动物森友会》更新海洋主题 DLC，玩家连夜钓鱼“上瘾”",
    desc: "新季节限定鱼种与潜水玩法上线，无人岛居民又忙了起来。",
    cover: null,
    timestamp: Date.now() - 30 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "国产动画《熊出没》大电影再破纪录，光头强携新伙伴回归",
    desc: "森林守护者们的冒险故事持续升温，合家欢观影首选。",
    cover: null,
    timestamp: Date.now() - 50 * 3_600_000,
    url: null,
  },
  // ---- 动物科普 / 冷知识（3）----
  {
    source: "Seed · 动物头条",
    title: "动物冷知识：章鱼有三颗心脏、血液呈蓝色",
    desc: "深海巨星的生理构造为何如此特殊？一文看懂头足类的生存智慧。",
    cover: null,
    timestamp: Date.now() - 22 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "为什么猫总爱把桌上的东西推下去？科学家给出解释",
    desc: "捕猎本能、领地意识与好奇心共同作用，你家主子其实在“练习”。",
    cover: null,
    timestamp: Date.now() - 33 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "企鹅的“膝盖”藏在身体里，摇摇晃晃走路其实是为省力",
    desc: "独特的骨骼结构与步态让企鹅在冰面行走更高效，也更可爱。",
    cover: null,
    timestamp: Date.now() - 44 * 3_600_000,
    url: null,
  },
];

/** 英文种子内容池（供 en 页面兜底，与中文 SEED_NEWS 一一对应）。 */
export const SEED_NEWS_EN: Omit<HotNews, "id" | "hot" | "isDomestic">[] = [
  // ---- Real animals (8) ----
  {
    source: "Seed · Animal News",
    title: "First wild giant panda fitted with a satellite collar, tracking data tops 10,000 km",
    desc: "Researchers track panda migration routes via satellite, providing new data for habitat protection.",
    cover: null,
    timestamp: Date.now() - 3 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Beijing volunteers' stray cat rescue station helps 200 cats find homes in a month",
    desc: "Loving volunteers run the station around the clock - neutering, deworming and adoption in one chain.",
    cover: null,
    timestamp: Date.now() - 5 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Giant panda twins at Shanghai Wildlife Park celebrate first month, online naming contest heats up",
    desc: "The twin cubs make their debut as fans flood in with names like 'Tuantuan' and 'Yuanyuan'.",
    cover: null,
    timestamp: Date.now() - 7 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Yunnan wild elephant herd continues northward trek, locals feed them pineapples and bananas",
    desc: "Rangers and villagers give way to the herd - a touching chapter of humans and nature in harmony.",
    cover: null,
    timestamp: Date.now() - 11 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "A cat cafe's orange tabby honored as lifetime resident after 12 years on the job",
    desc: "Clocking in daily and posing for photos, this tabby became the neighborhood's most beloved 'manager'.",
    cover: null,
    timestamp: Date.now() - 15 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Scientists discover humpback whales 'teach': calves learn hunting by following mothers",
    desc: "Underwater footage shows humpback mothers demonstrating bubble-net feeding, calves practicing repeatedly.",
    cover: null,
    timestamp: Date.now() - 20 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Chengdu Giant Panda Base welcomes its 20th newborn panda cub this year",
    desc: "Keepers share a photo of sleeping cub 'Tuanzi' - netizens say it's an overload of cuteness.",
    cover: null,
    timestamp: Date.now() - 26 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Australian koala rescue center saves 300 bushfire survivors, setting a record",
    desc: "Volunteer teams work 24-hour shifts to feed and rehabilitate, helping more koalas return to the wild.",
    cover: null,
    timestamp: Date.now() - 40 * 3_600_000,
    url: null,
  },
  // ---- Animal culture (4) ----
  {
    source: "Seed · Animal News",
    title: "Zootopia 2 announces release date, sloth Flash returns to delight fans",
    desc: "A new villain and a wider animal metropolis are revealed - fans can't wait.",
    cover: null,
    timestamp: Date.now() - 9 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Mufasa: The Lion King releases new trailer, continuing the circle of life",
    desc: "The origin legend of the Pride Lands unfolds as the classic melody returns.",
    cover: null,
    timestamp: Date.now() - 18 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Animal Crossing adds ocean-themed DLC, players up late fishing",
    desc: "New seasonal fish and diving gameplay land on the island - residents are busy again.",
    cover: null,
    timestamp: Date.now() - 30 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Chinese animation Boonie Bears breaks box office record again",
    desc: "The forest guardians' adventures keep warming hearts - a family favorite.",
    cover: null,
    timestamp: Date.now() - 50 * 3_600_000,
    url: null,
  },
  // ---- Animal science / trivia (3) ----
  {
    source: "Seed · Animal News",
    title: "Animal facts: octopuses have three hearts and blue blood",
    desc: "Why are deep-sea giants built so differently? A quick dive into cephalopod survival smarts.",
    cover: null,
    timestamp: Date.now() - 22 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Why do cats love pushing things off tables? Scientists explain",
    desc: "Hunting instinct, territory and curiosity combine - your cat is actually 'practicing'.",
    cover: null,
    timestamp: Date.now() - 33 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Penguins' 'knees' are hidden inside their bodies - their waddle saves energy",
    desc: "A unique skeleton and gait make penguins efficient on ice - and even cuter.",
    cover: null,
    timestamp: Date.now() - 44 * 3_600_000,
    url: null,
  },
];

/** 种子内容兜底（含热度分计算，timestamp 相对当前时间衰减）；按语言返回对应种子（全部标记为国内）。 */
export function seedHotNews(locale: "zh" | "en" = "zh"): HotNews[] {
  const now = Date.now();
  const pool = locale === "en" ? SEED_NEWS_EN : SEED_NEWS;
  return pool.map((n, i) => ({
    ...n,
    id: i + 1,
    hot: computeHotScore(1200 - i * 120, n.timestamp, now),
    isDomestic: true,
  }));
}
