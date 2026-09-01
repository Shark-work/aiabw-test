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
  /** 站内正文（正文抓取 / 种子完整短文；为空时详情页回退 desc） */
  content: string | null;
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
    content: "日前，一只野生大熊猫佩戴的卫星定位项圈累计追踪里程突破 1 万公里。科研团队利用实时回传的迁徙与栖息地数据，首次完整描绘出大熊猫在海拔 1500~3000 米之间的活动走廊。\n\n数据显示，这只熊猫每天平均移动 3.5 公里，春季向高山竹丛带迁移，冬季回撤至低海拔河谷。研究人员表示，这些数据将为栖息地破碎化治理与生态廊道规划提供直接依据。",
    cover: null,
    timestamp: Date.now() - 3 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "北京志愿者组建流浪猫救助站，一个月帮 200 只流浪猫找到新家",
    desc: "爱心志愿者轮班照料，绝育、驱虫、领养一条龙，让更多流浪猫告别街头。",
    content: "北京一支爱心志愿者团队自发组建流浪猫救助站，一个月内帮助 200 只流浪猫找到新家。救助站采用“抓捕—绝育—驱虫—领养”一站式流程，还设有线上直播认养区，让更多爱心人士参与。\n\n志愿者介绍，每只被救助的猫咪都有独立健康档案，领养前会进行性格评估与家庭适配沟通，最大限度降低二次遗弃率。",
    cover: null,
    timestamp: Date.now() - 5 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "上海野生动物园大熊猫双胞胎满月，线上征名活动火爆",
    desc: "双胞胎滚滚首次亮相，网友投稿的“团团”“圆圆”等名字热度飙升。",
    content: "上海野生动物园两只大熊猫双胞胎迎来满月，园方同步发起线上征名活动，引发网友热情参与。工作人员公布的照片里，两只小滚滚毛茸茸地挤在一起打盹，憨态可掬。\n\n截至目前，“团团”“圆圆”“年糕”“汤圆”等名字呼声最高。动物园表示，双胞胎已进入快速生长期，满百日后有望与游客见面。",
    cover: null,
    timestamp: Date.now() - 7 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "云南亚洲象群持续北上迁徙，沿途村民自发投喂菠萝香蕉",
    desc: "护林员与村民为象群让路，这一“象往”之旅成为人与自然和谐的生动注脚。",
    content: "云南一群野生亚洲象的北上之旅持续引发关注，护林员与沿途村民为象群主动让路，自发投喂菠萝、香蕉等水果。监测数据显示，象群整体健康状况良好，幼象活泼好动。\n\n当地林业部门以无人机与地面观测双线护航，实时发布象群位置提醒沿线居民注意安全。这场“象往”之旅成为人与自然和谐共生的生动注脚。",
    cover: null,
    timestamp: Date.now() - 11 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "英国一所猫咖的橘猫凭借“营业 12 年”获得社区终身荣誉居民",
    desc: "每天准时上班、陪客人拍照，这只橘猫成了街区最受欢迎的“店长”。",
    content: "英国一家猫咖的橘猫“店长”因为连续“营业”12 年，被社区授予终身荣誉居民称号。它每天准时“上岗”，陪客人拍照互动，成了街区最受欢迎的吉祥物。\n\n店主说，这只橘猫性格温顺从不怯场，很多老顾客都是专门来看它的。社区表示，授予荣誉居民既是对“劳模店长”多年陪伴的感谢，也提醒人们善待身边的每条生命。",
    cover: null,
    timestamp: Date.now() - 15 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "科学家发现座头鲸会“教学”：幼鲸跟随母亲学习捕食技巧",
    desc: "水下影像记录显示，座头鲸母亲会示范气泡网捕食法，幼鲸反复练习。",
    content: "科学家通过水下影像首次完整记录到座头鲸的“教学”行为：母亲在鱼群密集处演示气泡网捕食法，幼鲸则在一旁反复模仿练习。\n\n研究表明，这种知识传递通常持续数月，幼鲸才能逐步掌握气泡网的吹制节奏与收网时机。这是座头鲸文化传承的重要证据，刷新了人们对鲸类社会学习能力的认知。",
    cover: null,
    timestamp: Date.now() - 20 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "成都大熊猫繁育基地迎来今年第 20 只新生熊猫宝宝",
    desc: "饲养员晒出熊猫宝宝“团子”睡姿，网友直呼可爱暴击。",
    content: "成都大熊猫繁育研究基地迎来今年第 20 只新生熊猫宝宝。饲养员晒出的照片里，宝宝“团子”抱着竹子睡得正香，粉嫩的小爪子格外吸睛，网友直呼“可爱暴击”。\n\n基地负责人介绍，得益于繁殖技术与育幼经验的持续提升，今年新生幼仔存活率创下新高，未来将为圈养种群健康发展注入新鲜血液。",
    cover: null,
    timestamp: Date.now() - 26 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "澳大利亚考拉救护中心救助 300 只山火幸存考拉，创下纪录",
    desc: "志愿者团队 24 小时轮班喂养与康复，让更多考拉重返野外。",
    content: "澳大利亚一家考拉救护中心成功救助 300 只山火幸存考拉，创下该机构历史纪录。志愿者团队 24 小时轮班，为伤者进行烧伤清创、营养支持与康复训练。\n\n经过数月照料，大部分考拉已恢复健康并陆续重返栖息地。负责人表示，每一次放归都是对生命韧性的见证，也希望更多人关注气候变化对野生动物的影响。",
    cover: null,
    timestamp: Date.now() - 40 * 3_600_000,
    url: null,
  },
  // ---- 泛动物文化（4）----
  {
    source: "Seed · 动物头条",
    title: "《疯狂动物城2》官宣定档，树懒闪电回归引爆全网期待",
    desc: "新反派与更广阔的动物都市图景曝光，粉丝直呼“等太久了”。",
    content: "《疯狂动物城2》正式官宣定档，慢吞吞的树懒“闪电”确认回归，新预告中动物都市的更多角落同步曝光，粉丝直呼“等太久了”。\n\n据悉，续集将引入全新反派，并进一步扩展动物都市的格局与世界观。制作团队透露，新作在毛发渲染与城市景观细节上再次升级，力求带来更沉浸的观影体验。",
    cover: null,
    timestamp: Date.now() - 9 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "《狮子王：木法沙传奇》发布新预告，草原生命故事延续",
    desc: "荣耀大地的起源传说揭开面纱，经典旋律再度响起。",
    content: "《狮子王：木法沙传奇》发布全新预告，荣耀大地的起源传说终于揭开面纱，经典旋律再度响起，草原上的生命故事继续延续。\n\n预告展现了木法沙从幼狮成长为荣耀王国之王的全过程，以及他与兄弟之间复杂的情感羁绊。影片采用顶级虚拟制片技术，逼真的草原风光与群兽场面极具视觉冲击力。",
    cover: null,
    timestamp: Date.now() - 18 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "《动物森友会》更新海洋主题 DLC，玩家连夜钓鱼“上瘾”",
    desc: "新季节限定鱼种与潜水玩法上线，无人岛居民又忙了起来。",
    content: "《集合啦！动物森友会》更新海洋主题 DLC，新季节限定鱼种、潜水玩法与海洋家具同步上线，玩家们纷纷“加班”夜钓，直呼停不下来。\n\n新版本加入可互动的海底观光区，还能与全新 NPC 一起收集海洋生物图鉴。岛屿居民再度忙碌起来，社交平台上的讨论热度持续攀升。",
    cover: null,
    timestamp: Date.now() - 30 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "国产动画《熊出没》大电影再破纪录，光头强携新伙伴回归",
    desc: "森林守护者们的冒险故事持续升温，合家欢观影首选。",
    content: "国产动画电影《熊出没》系列再创票房纪录，光头强与熊大熊二带着新伙伴回归银幕。影片延续轻松欢乐的合家欢风格，森林守护者们的冒险故事持续升温。\n\n主创团队介绍，新作在幽默之余加入更多关于友情与守护的思考，适合全家一起观看，已成为国产动画电影的“常青树”。",
    cover: null,
    timestamp: Date.now() - 50 * 3_600_000,
    url: null,
  },
  // ---- 动物科普 / 冷知识（3）----
  {
    source: "Seed · 动物头条",
    title: "动物冷知识：章鱼有三颗心脏、血液呈蓝色",
    desc: "深海巨星的生理构造为何如此特殊？一文看懂头足类的生存智慧。",
    content: "章鱼有三颗心脏、血液呈蓝色？作为深海中最聪明的生物之一，章鱼的生理构造处处透着“高级感”：两颗鳃心脏负责供血，第三颗体心脏负责全身循环。\n\n由于血液中含有铜基的血蓝蛋白，章鱼的血液在含氧时呈蓝色。此外，它们拥有约 5 亿个神经元，反应敏捷、善于伪装，是当之无愧的“海底智多星”。",
    cover: null,
    timestamp: Date.now() - 22 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "为什么猫总爱把桌上的东西推下去？科学家给出解释",
    desc: "捕猎本能、领地意识与好奇心共同作用，你家主子其实在“练习”。",
    content: "为什么猫总爱把桌上的东西推下去？科学家指出，这其实是捕猎本能、领地意识与好奇心共同作用的结果。\n\n在猫看来，桌沿的小物件就像一只“猎物”，试探、拨动、推落的过程正是模拟捕猎练习；东西落地的声响和主人的反应，对猫而言都是“正反馈”。想减少破坏，收起易碎物品，并用逗猫棒满足它的捕猎欲。",
    cover: null,
    timestamp: Date.now() - 33 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · 动物头条",
    title: "企鹅的“膝盖”藏在身体里，摇摇晃晃走路其实是为省力",
    desc: "独特的骨骼结构与步态让企鹅在冰面行走更高效，也更可爱。",
    content: "企鹅的“膝盖”其实藏在身体里！企鹅腿骨分为股骨、胫骨与跗跖骨，看似弯曲的“膝盖”其实是跗跖关节。\n\n直立行走时，企鹅身体重心位于脚掌上方，配合独特的骨骼结构，让它们在冰面上行走比人类更省力。摇摇晃晃的步态不仅高效，还让它看起来格外憨厚可爱。",
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
    content: "A wild giant panda fitted with a satellite tracking collar has now clocked over 10,000 kilometres of movement data. Researchers used the real-time migration records to map the species' activity corridor between 1,500 and 3,000 metres above sea level, offering new insights for habitat conservation and corridor planning.",
    cover: null,
    timestamp: Date.now() - 3 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Beijing volunteers' stray cat rescue station helps 200 cats find homes in a month",
    desc: "Loving volunteers run the station around the clock - neutering, deworming and adoption in one chain.",
    content: "A volunteer-run rescue station in Beijing has helped 200 stray cats find new homes in a month. Using a trap-neuter-vaccinate-rehome workflow with health files and adopter matching, the team is cutting re-abandonment and giving more strays a second chance.",
    cover: null,
    timestamp: Date.now() - 5 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Giant panda twins at Shanghai Wildlife Park celebrate first month, online naming contest heats up",
    desc: "The twin cubs make their debut as fans flood in with names like 'Tuantuan' and 'Yuanyuan'.",
    content: "Twin panda cubs at Shanghai Wildlife Park celebrated their one-month milestone with a public naming contest. Photos of the fluffy duo snoozing together went viral, with names like 'Tuantuan' and 'Tangyuan' topping the polls. The cubs are expected to meet visitors after 100 days.",
    cover: null,
    timestamp: Date.now() - 7 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Yunnan wild elephant herd continues northward trek, locals feed them pineapples and bananas",
    desc: "Rangers and villagers give way to the herd - a touching chapter of humans and nature in harmony.",
    content: "A herd of wild Asian elephants trekking north through Yunnan continues to capture hearts, with villagers voluntarily offering bananas and pineapples while rangers clear the way. Drone and ground teams track the herd around the clock, and all elephants are reported healthy.",
    cover: null,
    timestamp: Date.now() - 11 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "A cat cafe's orange tabby honored as lifetime resident after 12 years on the job",
    desc: "Clocking in daily and posing for photos, this tabby became the neighborhood's most beloved 'manager'.",
    content: "A cafe orange cat in the UK has been named honorary resident for life after 12 years of loyal 'shifts'. It greets customers daily and has become the neighbourhood's most beloved mascot - a heartwarming reminder to care for the animals around us.",
    cover: null,
    timestamp: Date.now() - 15 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Scientists discover humpback whales 'teach': calves learn hunting by following mothers",
    desc: "Underwater footage shows humpback mothers demonstrating bubble-net feeding, calves practicing repeatedly.",
    content: "Underwater footage has captured humpback whales 'teaching' for the first time: mothers demonstrate bubble-net feeding while calves practice repeatedly. The months-long knowledge transfer highlights whales' remarkable social learning and cultural transmission.",
    cover: null,
    timestamp: Date.now() - 20 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Chengdu Giant Panda Base welcomes its 20th newborn panda cub this year",
    desc: "Keepers share a photo of sleeping cub 'Tuanzi' - netizens say it's an overload of cuteness.",
    content: "Chengdu Giant Panda Breeding Base welcomed its 20th newborn cub this year. Keepers shared a photo of sleeping cub 'Tuanzi' that delighted netizens. Thanks to improved breeding and care techniques, cub survival rates have hit a new high.",
    cover: null,
    timestamp: Date.now() - 26 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Australian koala rescue center saves 300 bushfire survivors, setting a record",
    desc: "Volunteer teams work 24-hour shifts to feed and rehabilitate, helping more koalas return to the wild.",
    content: "An Australian koala rescue centre has rehabilitated a record 300 bushfire survivors. Volunteer teams worked 24-hour shifts on wound care, nutrition and recovery; most koalas have since been released back into the wild.",
    cover: null,
    timestamp: Date.now() - 40 * 3_600_000,
    url: null,
  },
  // ---- Animal culture (4) ----
  {
    source: "Seed · Animal News",
    title: "Zootopia 2 announces release date, sloth Flash returns to delight fans",
    desc: "A new villain and a wider animal metropolis are revealed - fans can't wait.",
    content: "Zootopia 2 has announced its release date, with sloth Flash confirmed to return. A new villain and a broader animal metropolis are teased in fresh footage, and fans say they have waited far too long.",
    cover: null,
    timestamp: Date.now() - 9 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Mufasa: The Lion King releases new trailer, continuing the circle of life",
    desc: "The origin legend of the Pride Lands unfolds as the classic melody returns.",
    content: "The Lion King prequel Mufasa has dropped a new trailer, unveiling the origin story of the Pride Lands as the classic melody returns. Stunning virtual-production landscapes and sweeping animal herds have fans excited.",
    cover: null,
    timestamp: Date.now() - 18 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Animal Crossing adds ocean-themed DLC, players up late fishing",
    desc: "New seasonal fish and diving gameplay land on the island - residents are busy again.",
    content: "Animal Crossing's new ocean-themed DLC adds seasonal fish, diving gameplay and underwater sightseeing, and players are staying up late to catch rare species. Island life is busier - and cuter - than ever.",
    cover: null,
    timestamp: Date.now() - 30 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Chinese animation Boonie Bears breaks box office record again",
    desc: "The forest guardians' adventures keep warming hearts - a family favorite.",
    content: "Chinese animated film Boonie Bears has set another box-office record as Logger Vick and the bear brothers return with new friends. The family favourite blends humour with warm stories of friendship and guardianship.",
    cover: null,
    timestamp: Date.now() - 50 * 3_600_000,
    url: null,
  },
  // ---- Animal science / trivia (3) ----
  {
    source: "Seed · Animal News",
    title: "Animal facts: octopuses have three hearts and blue blood",
    desc: "Why are deep-sea giants built so differently? A quick dive into cephalopod survival smarts.",
    content: "Octopuses have three hearts and blue blood! Two branchial hearts pump blood to the gills, while a systemic heart drives circulation. Copper-based haemocyanin makes their blood blue, and their ~500 million neurons make them true ocean geniuses.",
    cover: null,
    timestamp: Date.now() - 22 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Why do cats love pushing things off tables? Scientists explain",
    desc: "Hunting instinct, territory and curiosity combine - your cat is actually 'practicing'.",
    content: "Why do cats love pushing things off tables? Scientists say it combines hunting instinct, territorial behaviour and curiosity. To a cat, a table-edge object is 'prey' to bat around - and the noise plus your reaction are rewarding. Try satisfying that hunting drive with a wand toy.",
    cover: null,
    timestamp: Date.now() - 33 * 3_600_000,
    url: null,
  },
  {
    source: "Seed · Animal News",
    title: "Penguins' 'knees' are hidden inside their bodies - their waddle saves energy",
    desc: "A unique skeleton and gait make penguins efficient on ice - and even cuter.",
    content: "Penguins' 'knees' are hidden inside their bodies! What looks like a knee is actually the ankle joint. Their upright stance and unique skeleton make waddling surprisingly energy-efficient on ice - and utterly adorable.",
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
