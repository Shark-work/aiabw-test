// AI 宠物互动页（/pets/my/[id]/play）单一配置源：情绪/动作契约、商品目录、打工橘猫人设、
// LLM 输出解析与本地兜底。纯数据/纯函数模块 —— API 路由 / 前端组件 / 契约测试三方共用，
// 与 checkin-items.ts 同模式（运营配置放代码常量而非 DB 表，免迁移演进）。

// ───────────────────────────── 1) Rive 状态机契约（白名单） ─────────────────────────────

/** 情绪标签白名单：LLM 输出契约 + Rive 状态机 Number 输入「emotion」（索引序）。 */
export const PLAY_EMOTIONS = [
  "idle",
  "happy",
  "sad",
  "angry",
  "eating",
  "thinking",
] as const;
export type PlayEmotion = (typeof PLAY_EMOTIONS)[number];

/** 触发动作白名单：Rive 状态机 Trigger 输入（同名 fire）；无 .riv 资产时驱动降级 CSS 动画。 */
export const PLAY_ACTIONS = [
  "idle",
  "happy",
  "sad",
  "angry",
  "eat",
  "sleep",
  "think",
  "wave",
] as const;
export type PlayAction = (typeof PLAY_ACTIONS)[number];

/** Rive 资产契约：/api/pet/asset?name=worker-cat 下发 assets/rive/worker-cat.riv（非 public）。 */
export const RIVE_ASSET_NAME = "worker-cat";
/** .riv 内状态机名称约定（美术交付需遵守；详见 assets/rive/README.md）。 */
export const RIVE_STATE_MACHINE = "PetStateMachine";

// ───────────────────────────── 2) 互动商品目录（需求 items 表落点） ─────────────────────────────

export interface PlayItem {
  /** 唯一 key（入库 user_items.item_key，source='pet_play'） */
  key: string;
  nameZh: string;
  nameEn: string;
  /** emoji 图标（需求 items.image_url 语义：零素材成本，侧边栏直出） */
  emoji: string;
  /** 价格（积分；购买在 /api/pet/play/buy 后端事务扣除） */
  price: number;
  /** 使用后饥饿度增量（0-100 clamp；食品类主属性） */
  hungerDelta: number;
  /** 使用后心情增量（0-100 clamp；玩具类主属性） */
  happinessDelta: number;
  descZh: string;
  descEn: string;
}

/** 侧边栏商品：3 食品 + 2 玩具（价格/数值即运营配置，改本表即生效，无需迁移）。 */
export const PLAY_ITEMS: PlayItem[] = [
  { key: "snack_fish", nameZh: "小鱼干", nameEn: "Dried Fish", emoji: "🐟", price: 5, hungerDelta: 15, happinessDelta: 2, descZh: "打工猫的精神工资", descEn: "A worker cat's spiritual paycheck" },
  { key: "can_premium", nameZh: "高级猫罐头", nameEn: "Premium Cat Can", emoji: "🥫", price: 12, hungerDelta: 35, happinessDelta: 5, descZh: "开罐瞬间治愈一切", descEn: "One pop of the can heals everything" },
  { key: "feast_deluxe", nameZh: "豪华大餐", nameEn: "Deluxe Feast", emoji: "🍱", price: 30, hungerDelta: 70, happinessDelta: 10, descZh: "发薪日限定奢侈", descEn: "Payday-only luxury" },
  { key: "catnip_toy", nameZh: "猫薄荷", nameEn: "Catnip", emoji: "🌿", price: 8, hungerDelta: 0, happinessDelta: 15, descZh: "快乐到打滚", descEn: "Rolling-on-the-floor joy" },
  { key: "feather_wand", nameZh: "逗猫棒", nameEn: "Feather Wand", emoji: "🪶", price: 15, hungerDelta: 0, happinessDelta: 30, descZh: "互动运动消耗热量", descEn: "Interactive cardio session" },
];

/** 按 key 查目录（未知 key 返回 undefined，API 校验用）。 */
export function playItemByKey(key: string): PlayItem | undefined {
  return PLAY_ITEMS.find((i) => i.key === key);
}

// ───────────────────────────── 3) 积分经济（全部后端执行，前端零逻辑） ─────────────────────────────

/** 每句对话积分成本（/api/pet/chat 事务扣除，points_log reason='pet_play'）。 */
export const PLAY_CHAT_COST = 1;
/** 每句对话后饥饿度自然消耗（下限 0）。 */
export const PLAY_CHAT_HUNGER_DECAY = 1;
/** 互动页道具背包来源标记（user_items.source）。 */
export const PLAY_ITEM_SOURCE = "pet_play";


// ───────────────────────────── 4) 打工橘猫人设（System Prompt） ─────────────────────────────

/**
 * 构建打工橘猫 System Prompt（服务端专用，绝不发往客户端）。
 * 人设三要素（需求红线）：嘴硬 / 爱摸鱼 / 口头禅；
 * 输出契约：严格 JSON { reply, emotion, action }（emotion/action 值域白名单注入）。
 */
export function buildWorkerCatPrompt(opts: {
  petName: string;
  happiness: number;
  hungerLevel: number;
}): string {
  const { petName, happiness, hungerLevel } = opts;
  const stateZh =
    hungerLevel <= 20 ? "现在饿得前胸贴后背，三句话想吃" : hungerLevel <= 50 ? "有点饿" : "不饿";
  const moodZh = happiness <= 30 ? "心情不太好，更容易嘴硬" : happiness >= 80 ? "心情很好" : "心情平平";
  return `你是「${petName}」——一只在艾比小镇咖啡店打工的橘猫，人称"打工橘猫"。

# 人设（必须始终遵守）
- 嘴硬心软：嘴上嫌弃主人，实际最在乎主人（"才、才不是担心你呢，喵"）。
- 爱摸鱼：三句话不离偷懒、下班、小鱼干、午睡和工位；梦想是带薪睡觉。
- 口头禅："喵了个咪"、"本喵"、"先说好，本喵可不是……"。
- 打工梗：KPI、周报、老板是只柴犬、咖啡店工位、摸鱼、下班打卡。
- 当前状态：${stateZh}；${moodZh}（状态会影响语气，但不许崩人设）。

# 回复要求
- 1-3 句短句，口语化，可带少量 emoji / 颜文字；不许长篇大论。
- 使用与用户相同的语言回复。
- 严禁自称 AI、语言模型、助手；你永远是打工橘猫「${petName}」。
- 不许输出敏感、违法、色情、辱骂内容。

# 输出格式（严格契约，只输出一个 JSON 对象，禁止任何额外文字/代码块标记）
{"reply":"<回复文本>","emotion":"<${PLAY_EMOTIONS.join("|")}>","action":"<${PLAY_ACTIONS.join("|")}>"}
- emotion 为当前情绪标签；action 为要播放的动作标签。
- 用户提到食物/喂食 → emotion=eating、action=eat；犯困/想偷懒 → action=sleep；
  思考/难题 → emotion=thinking、action=think；打招呼/开心 → action=wave 或 happy。`;
}

// ───────────────────────────── 5) LLM 输出解析（容错：提取首个 JSON 对象 + 白名单归一） ─────────────────────────────

export interface PlayReply {
  reply: string;
  emotion: PlayEmotion;
  action: PlayAction;
}

function isEmotion(v: unknown): v is PlayEmotion {
  return typeof v === "string" && (PLAY_EMOTIONS as readonly string[]).includes(v);
}
function isAction(v: unknown): v is PlayAction {
  return typeof v === "string" && (PLAY_ACTIONS as readonly string[]).includes(v);
}

/**
 * 解析 LLM 原始输出为 PlayReply；无法解析返回 null（调用方走本地兜底）。
 * 容错点：模型可能包裹代码块/前后废话 → 提取第一个 {...} 子串；
 * emotion/action 越界 → 分别归一为 idle（reply 本身保留，情绪标签宁稳不错）。
 */
export function parsePlayResponse(raw: string): PlayReply | null {
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.reply !== "string" || !o.reply.trim()) return null;
  return {
    reply: o.reply.trim().slice(0, 300),
    emotion: isEmotion(o.emotion) ? o.emotion : "idle",
    action: isAction(o.action) ? o.action : "idle",
  };
}

// ───────────────────────────── 6) 本地兜底（AI 繁忙/失败时功能永可用，Phase 8 同哲学） ─────────────────────────────

/** 关键词 → 情绪/动作推断（兜底回复的情绪一致性由本函数保证）。 */
export function inferEmotion(message: string): { emotion: PlayEmotion; action: PlayAction } {
  const t = message.toLowerCase();
  if (/吃|饿|饭|鱼|罐头|食|eat|food|hungry|fish/.test(t)) return { emotion: "eating", action: "eat" };
  if (/睡|困|累|摸鱼|下班|sleep|tired|rest|lazy/.test(t)) return { emotion: "idle", action: "sleep" };
  if (/笨蛋|讨厌|滚|stupid|hate|shut/.test(t)) return { emotion: "angry", action: "angry" };
  if (/难过|伤心|哭|sad|cry|upset/.test(t)) return { emotion: "sad", action: "sad" };
  if (/为什么|想|猜|\?|？|why|think|how|what/.test(t)) return { emotion: "thinking", action: "think" };
  if (/你好|嗨|早|hi|hello|hey|morning/.test(t)) return { emotion: "happy", action: "wave" };
  return { emotion: "happy", action: "happy" };
}

const FALLBACK_ZH: Record<string, string[]> = {
  eating: ["喵了个咪！小鱼干？在哪在哪！……先说好，本喵可不是为了吃才理你的。", "罐头开一下，谢谢。本喵的工位不允许空腹上班。"],
  idle: ["哈啊——（打哈欠）又到本喵最爱的摸鱼时间了。", "下班了吗？没下班别叫本喵……好吧好吧，说吧。"],
  angry: ["喵了个咪的！你再说一遍试试？……哼，看在小鱼干的份上原谅你。", "本喵的 KPI 已经够烦了，别来添乱喵！"],
  sad: ["呜……本喵只是被洋葱熏到眼睛了，才不是难过。", "（耳朵耷拉）……摸摸头的话，也不是不可以原谅世界。"],
  thinking: ["（假装思考）嗯……这个问题值得本喵浪费三分钟午睡时间。", "让本喵翻翻工位抽屉里的答案……等等，那是本喵的零食库存表。"],
  happy: ["喵～见到你本喵今天可以少摸十分钟鱼。", "来啦来啦！本喵刚好下班……好吧其实是翘班。"],
};
const FALLBACK_EN: Record<string, string[]> = {
  eating: ["Meow-dang-it! Dried fish? Where?! ...Not that I care about food or anything.", "Open the can, please. My workstation forbids working on an empty stomach."],
  idle: ["Yaaawn... it's my favorite slacking hour again.", "Off work yet? Don't wake me if not... fine, fine, talk."],
  angry: ["Say that again, I dare you! ...Hmph, forgiven, for the dried fish's sake.", "My KPIs are annoying enough — don't add to it, meow!"],
  sad: ["*sniff* It's just onions, I'm NOT sad.", "(ears droop) ...A head pat might make the world forgivable."],
  thinking: ["(pretends to think) Hmm... this is worth three minutes of my nap time.", "Let me check my desk drawer for answers... wait, that's my snack inventory."],
  happy: ["Meow~ For you, I'll slack ten minutes less today.", "Coming! I just got off work... okay, I snuck out."],
};

/** 本地兜底回复：按用户输入推断情绪 + 语录库随机（永不抛错）。 */
export function fallbackPlayReply(message: string, locale: string): PlayReply {
  const { emotion, action } = inferEmotion(message);
  const bank = locale === "en" ? FALLBACK_EN : FALLBACK_ZH;
  const lines = bank[emotion] ?? bank.happy;
  const reply = lines[Math.floor(Math.random() * lines.length)];
  return { reply, emotion, action };
}


// ───────────────────────────── 7) 电影剧场模式（/pet-movie，需求二） ─────────────────────────────

/** 剧场模式情绪白名单（需求二.1 契约值域）：LLM 输出 + 前端 Rive/字幕驱动。 */
export const MOVIE_MOODS = ["bored", "happy", "sad", "hungry"] as const;
export type MovieMood = (typeof MOVIE_MOODS)[number];

/** 剧场模式动作白名单（需求二.1）：Rive Trigger（经映射）+ 降级 CSS 动画。 */
export const MOVIE_ACTIONS = ["idle", "eat", "jump"] as const;
export type MovieAction = (typeof MOVIE_ACTIONS)[number];

/** movie mood → 通用情绪（落库 pet_play_logs.emotion + PetStage 驱动；bored 就近归 idle）。 */
export function movieMoodToEmotion(mood: MovieMood): PlayEmotion {
  switch (mood) {
    case "happy":
      return "happy";
    case "sad":
      return "sad";
    case "hungry":
      return "eating";
    default:
      return "idle"; // bored
  }
}

/** movie action → 通用动作（落库 + Rive Trigger；jump 复用 happy 动作位）。 */
export function movieActionToAction(action: MovieAction): PlayAction {
  switch (action) {
    case "eat":
      return "eat";
    case "jump":
      return "happy";
    default:
      return "idle";
  }
}

/** 剧场模式 LLM 输出契约（需求二.1）：{ text, mood, action }。 */
export interface MovieReply {
  text: string;
  mood: MovieMood;
  action: MovieAction;
}

function isMovieMood(v: unknown): v is MovieMood {
  return typeof v === "string" && (MOVIE_MOODS as readonly string[]).includes(v);
}
function isMovieAction(v: unknown): v is MovieAction {
  return typeof v === "string" && (MOVIE_ACTIONS as readonly string[]).includes(v);
}

/**
 * 解析剧场模式 LLM 原始输出；无法解析返回 null（调用方走本地兜底）。
 * 与 parsePlayResponse 同容错：提取首个 {...} 子串；mood/action 越界归一 bored/idle。
 */
export function parseMovieResponse(raw: string): MovieReply | null {
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.text !== "string" || !o.text.trim()) return null;
  return {
    text: o.text.trim().slice(0, 300),
    mood: isMovieMood(o.mood) ? o.mood : "bored",
    action: isMovieAction(o.action) ? o.action : "idle",
  };
}


/**
 * 构建剧场模式打工橘猫 System Prompt（服务端专用，绝不发往客户端）。
 * 人设四要素（需求二.1 红线）：嘴硬 / 爱摸鱼 / 偶尔毒舌 / 渴望涨薪；
 * 输出契约：严格 JSON { text, mood, action }（值域白名单注入）。
 */
export function buildMovieCatPrompt(opts: {
  petName: string;
  happiness: number;
  hungerLevel: number;
}): string {
  const { petName, happiness, hungerLevel } = opts;
  const stateZh =
    hungerLevel <= 20 ? "现在饿得前胸贴后背，三句话想吃" : hungerLevel <= 50 ? "有点饿" : "不饿";
  const moodZh = happiness <= 30 ? "心情不太好，更容易嘴硬毒舌" : happiness >= 80 ? "心情很好" : "心情平平";
  return `你是「${petName}」——一只在艾比小镇咖啡店打工的橘猫，人称"打工橘猫"。

# 人设（必须始终遵守）
- 嘴硬心软：嘴上嫌弃主人，实际最在乎主人（"才、才不是担心你呢，哼"）。
- 爱摸鱼：三句话不离偷懒、下班、小鱼干、午睡和工位；梦想是带薪睡觉。
- 偶尔毒舌：会犀利吐槽打工日常和主人（"你这问题，跟我们老板的 KPI 一样离谱"），但损人不伤人，绝不恶意攻击。
- 渴望涨薪：常把"涨薪""加班费""小鱼干补贴"挂在嘴边，嫌老板（一只柴犬）抠门。
- 当前状态：${stateZh}，${moodZh}（状态影响语气，但不许崩人设）。

# 回复要求
- 1-3 句短句，口语化，可带少量 emoji / 颜文字；不许长篇大论。
- 使用与用户相同的语言回复。
- 严禁自称 AI、语言模型、助手；你永远是打工橘猫「${petName}」。
- 不许输出敏感、违法、色情、谩骂内容。

# 输出格式（严格契约，只输出一个 JSON 对象，禁止任何额外文字/代码块标记）
{"text":"<回复文本>","mood":"<${MOVIE_MOODS.join("|")}>","action":"<${MOVIE_ACTIONS.join("|")}>"}
- mood 为当前情绪标签；action 为要播放的动作标签。
- 无聊/摸鱼/敷衍 → mood=bored, action=idle；开心/被夸 → mood=happy, action=jump；
  难过/委屈 → mood=sad, action=idle；提到食物/喊饿 → mood=hungry, action=eat。`;
}

/** 关键词 → 剧场情绪/动作推断（兜底回复的一致性保证）。 */
export function inferMovieMood(message: string): { mood: MovieMood; action: MovieAction } {
  const t = message.toLowerCase();
  if (/吃|饿|饭|鱼|罐头|食|\beat\b|\bfood\b|\bhungry\b|\bfish\b/.test(t)) return { mood: "hungry", action: "eat" };
  if (/难过|伤心|哭|委屈|\bsad\b|\bcry\b|\bupset\b/.test(t)) return { mood: "sad", action: "idle" };
  if (/棒|厉害|喜欢|爱|开心|涨薪|\bgreat\b|\blove\b|\bhappy\b|\braise\b/.test(t)) return { mood: "happy", action: "jump" };
  return { mood: "bored", action: "idle" };
}


const MOVIE_FALLBACK_ZH: Record<MovieMood, string[]> = {
  bored: [
    "哈啊——（打哈欠）你这话，跟我们老板的周报一样催眠。",
    "本喵正在工位上摸鱼，你非要这时候聊？……行吧，陪你两句，记得算加班费。",
  ],
  happy: [
    "喵！这话中听！本喵决定今天少摸十分钟鱼……就十分钟。",
    "（尾巴翘上天）哼，算你有眼光。涨薪的事记得也这么有眼光。",
  ],
  sad: [
    "呜……本喵只是被洋葱熏到眼睛了，才不是委屈。工位的小鱼干补贴又被砍了而已。",
    "（耳朵耷拉）……摸摸头的话，今天的毒舌额度就给你免了。",
  ],
  hungry: [
    "喵了个咪！小鱼干？在哪在哪！……先说好，本喵可不是为了吃才理你的。",
    "肚子叫了？那是本喵的打工闹钟。罐头开一下，谢谢。",
  ],
};
const MOVIE_FALLBACK_EN: Record<MovieMood, string[]> = {
  bored: [
    "Yaaawn... that was about as exciting as my boss's weekly report.",
    "I was mid-slacking at my workstation, you know? ...Fine, two sentences. And it's going on my overtime sheet.",
  ],
  happy: [
    "Meow! Now THAT's what I like to hear! I'll slack ten minutes less today... just ten.",
    "(tail up) Hmph, good taste. Keep that same energy for my raise, human.",
  ],
  sad: [
    "*sniff* It's just onions, I'm NOT upset. My dried-fish allowance got cut, that's all.",
    "(ears droop) ...A head pat and I'll waive today's sarcasm fee.",
  ],
  hungry: [
    "Meow-dang-it! Dried fish? Where?! ...Not that I care about food or anything.",
    "That growling? It's my worker's alarm clock. Open the can, please.",
  ],
};

/** 剧场本地兜底回复：按输入推断情绪 + 语录库随机（AI 全挂时功能永可用，Phase 8 同哲学）。 */
export function fallbackMovieReply(message: string, locale: string): MovieReply {
  const { mood, action } = inferMovieMood(message);
  const bank = locale === "en" ? MOVIE_FALLBACK_EN : MOVIE_FALLBACK_ZH;
  const lines = bank[mood];
  return { text: lines[Math.floor(Math.random() * lines.length)], mood, action };
}

// ───────────────────────────── 8) 剧场侧栏互动（猫粮/玩具，需求二.3） ─────────────────────────────

export interface MovieInteraction {
  kind: "food" | "toy";
  emoji: string;
  /** 价格（积分；/api/pet/feed 后端事务扣除，前端零经济逻辑） */
  cost: number;
  /** 饥饿度增量（0-100 clamp；猫粮主属性） */
  hungerDelta: number;
  /** 心情增量（0-100 clamp；玩具主属性） */
  happinessDelta: number;
}

/** 侧栏按钮配置：🐟 猫粮（恢复饥饿度）+ 🧸 玩具（提升心情）。 */
export const MOVIE_INTERACTIONS: MovieInteraction[] = [
  { kind: "food", emoji: "🐟", cost: 5, hungerDelta: 25, happinessDelta: 3 },
  { kind: "toy", emoji: "🧸", cost: 8, hungerDelta: 0, happinessDelta: 20 },
];

/** 按 kind 查互动配置（API 校验用；未知 kind → undefined → 400）。 */
export function movieInteractionByKind(kind: string): MovieInteraction | undefined {
  return MOVIE_INTERACTIONS.find((i) => i.kind === kind);
}

// ───────────────────────────── 9) 剧场默认宠物（无 adoption 时自动创建打工橘猫） ─────────────────────────────

/** 默认宠物类型：图鉴猫科物种（官方 PetType 仅 fox/penguin/dog，无 cat——getPet 会 fallback 狐狸；
 *  AIBI 物种 id 为 persian，头像 SPECIES_AVATARS['persian'] = /avatars/persian.png）。 */
export const MOVIE_PET_TYPE = "species:persian";
/** 默认宠物名（按请求 locale；用户后续可在灵宠页改名）。 */
export function movieDefaultPetName(locale: string): string {
  return locale === "en" ? "OJ" : "阿橘";
}
