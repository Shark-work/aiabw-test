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

/** 动物相关关键词（采集层命中才收录，避免无关资讯）。 */
const ANIMAL_KEYWORDS = [
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
  "猫",
  "狗",
];

export function isAnimalRelated(text: string): boolean {
  const lower = text.toLowerCase();
  return ANIMAL_KEYWORDS.some((k) => lower.includes(k));
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

/** 种子内容池：抓取源不可达时兜底（精选动物趣闻，含互动基数与发布时间）。 */
export const SEED_NEWS: Omit<HotNews, "id" | "hot">[] = [
  {
    source: "Seed · 动物头条",
    title: "全球首只成功佩戴卫星项圈的野生大熊猫，追踪数据突破 1 万公里",
    desc: "科研团队通过卫星追踪大熊猫迁徙路线，为栖息地保护提供全新数据支持。",
    cover: null,
    timestamp: Date.now() - 3 * 3_600_000,
    url: "https://www.aiabw.com/pets?species=giant_panda",
  },
  {
    source: "Seed · 动物头条",
    title: "英国一所猫咖的橘猫凭借“营业 12 年”获得社区终身荣誉居民",
    desc: "每天准时上班、陪客人拍照，这只橘猫成了街区最受欢迎的“店长”。",
    cover: null,
    timestamp: Date.now() - 7 * 3_600_000,
    url: "https://www.aiabw.com/pets?species=maine_coon",
  },
  {
    source: "Seed · 动物头条",
    title: "科学家发现座头鲸会“教学”：幼鲸跟随母亲学习捕食技巧",
    desc: "水下影像记录显示，座头鲸母亲会示范气泡网捕食法，幼鲸反复练习。",
    cover: null,
    timestamp: Date.now() - 15 * 3_600_000,
    url: "https://www.aiabw.com/pets?species=whale",
  },
  {
    source: "Seed · 动物头条",
    title: "成都大熊猫繁育基地迎来今年第 20 只新生熊猫宝宝",
    desc: "饲养员晒出熊猫宝宝“团子”睡姿，网友直呼可爱暴击。",
    cover: null,
    timestamp: Date.now() - 26 * 3_600_000,
    url: "https://www.aiabw.com/pets?species=giant_panda",
  },
  {
    source: "Seed · 动物头条",
    title: "澳大利亚考拉救护中心救助 300 只山火幸存考拉，创下纪录",
    desc: "志愿者团队 24 小时轮班喂养与康复，让更多考拉重返野外。",
    cover: null,
    timestamp: Date.now() - 40 * 3_600_000,
    url: "https://www.aiabw.com/pets?species=koala",
  },
];

/** 英文种子内容池（供 en 页面兜底，与中文 SEED_NEWS 一一对应）。 */
export const SEED_NEWS_EN: Omit<HotNews, "id" | "hot">[] = [
  {
    source: "Seed · Animal News",
    title: "First wild giant panda fitted with a satellite collar, tracking data tops 10,000 km",
    desc: "Researchers track panda migration routes via satellite, providing new data for habitat protection.",
    cover: null,
    timestamp: Date.now() - 3 * 3_600_000,
    url: "https://www.aiabw.com/pets?species=giant_panda",
  },
  {
    source: "Seed · Animal News",
    title: "A cat cafe's orange tabby honored as lifetime resident after 12 years on the job",
    desc: "Clocking in daily and posing for photos, this tabby became the neighborhood's most beloved 'manager'.",
    cover: null,
    timestamp: Date.now() - 7 * 3_600_000,
    url: "https://www.aiabw.com/pets?species=maine_coon",
  },
  {
    source: "Seed · Animal News",
    title: "Scientists discover humpback whales 'teach': calves learn hunting by following mothers",
    desc: "Underwater footage shows humpback mothers demonstrating bubble-net feeding, calves practicing repeatedly.",
    cover: null,
    timestamp: Date.now() - 15 * 3_600_000,
    url: "https://www.aiabw.com/pets?species=whale",
  },
  {
    source: "Seed · Animal News",
    title: "Chengdu Giant Panda Base welcomes its 20th newborn panda cub this year",
    desc: "Keepers share a photo of sleeping cub 'Tuanzi' - netizens say it's an overload of cuteness.",
    cover: null,
    timestamp: Date.now() - 26 * 3_600_000,
    url: "https://www.aiabw.com/pets?species=giant_panda",
  },
  {
    source: "Seed · Animal News",
    title: "Australian koala rescue center saves 300 bushfire survivors, setting a record",
    desc: "Volunteer teams work 24-hour shifts to feed and rehabilitate, helping more koalas return to the wild.",
    cover: null,
    timestamp: Date.now() - 40 * 3_600_000,
    url: "https://www.aiabw.com/pets?species=koala",
  },
];

/** 种子内容兜底（含热度分计算，timestamp 相对当前时间衰减）；按语言返回对应种子。 */
export function seedHotNews(locale: "zh" | "en" = "zh"): HotNews[] {
  const now = Date.now();
  const pool = locale === "en" ? SEED_NEWS_EN : SEED_NEWS;
  return pool.map((n, i) => ({
    ...n,
    id: i + 1,
    hot: computeHotScore(1200 - i * 120, n.timestamp, now),
  }));
}
