// AI 宠物互动契约层：情绪/动作统一枚举（re-export 自角色注册表）、商品目录、
// 积分经济常量、LLM 输出解析（{ text, mood, intensity } 契约 + 白名单归一）、本地兜底。
// 人设 / System Prompt / 台词库 → src/lib/pets/characters.ts（需求一：统一角色数据源）。
// 纯数据/纯函数模块 —— API 路由 / 前端组件 / 契约测试三方共用。

import {
  actionForMood,
  resolveCharacter,
  type PetMood,
} from "@/lib/pets/characters";

// 统一情绪/动作契约 re-export（前端组件与 API 路由继续从本模块取契约，单一 import 口）。
export {
  PET_MOODS,
  PET_ACTIONS,
  MOOD_ACTION_MAP,
  actionForMood,
  RIVE_ASSET_NAME,
  RIVE_STATE_MACHINE,
  type PetMood,
  type PetAction,
} from "@/lib/pets/characters";

// ───────────────────────────── 1) 互动商品目录（需求四.1 道具表） ─────────────────────────────

export interface PlayItem {
  /** 唯一 key（入库 user_items.item_key，source='pet_play'） */
  key: string;
  nameZh: string;
  nameEn: string;
  /** emoji 图标（零素材成本，侧边栏直出） */
  emoji: string;
  /** 价格（积分；购买在 /api/pet/play/buy 后端事务扣除） */
  price: number;
  /** 使用后饥饿度增量（0-100 clamp；食品类主属性） */
  hungerDelta: number;
  /** 使用后心情增量（0-100 clamp；玩具类主属性） */
  happinessDelta: number;
  /** 使用效果（前端播 eat / happy 动作的依据） */
  effect: "eat" | "play";
  descZh: string;
  descEn: string;
}

/** 侧边栏商品：3 食品（猫粮/罐头/大餐）+ 2 玩具（猫薄荷/逗猫棒）——价格/数值即运营配置。 */
export const PLAY_ITEMS: PlayItem[] = [
  { key: "snack_fish", nameZh: "小鱼干猫粮", nameEn: "Dried-fish Kibble", emoji: "🐟", price: 5, hungerDelta: 15, happinessDelta: 2, effect: "eat", descZh: "打工猫的精神工资", descEn: "A worker cat's spiritual paycheck" },
  { key: "can_premium", nameZh: "高级猫罐头", nameEn: "Premium Cat Can", emoji: "🥫", price: 12, hungerDelta: 35, happinessDelta: 5, effect: "eat", descZh: "开罐瞬间治愈一切", descEn: "One pop of the can heals everything" },
  { key: "feast_deluxe", nameZh: "豪华大餐", nameEn: "Deluxe Feast", emoji: "🍱", price: 30, hungerDelta: 70, happinessDelta: 10, effect: "eat", descZh: "发薪日限定奢侈", descEn: "Payday-only luxury" },
  { key: "catnip_toy", nameZh: "猫薄荷", nameEn: "Catnip", emoji: "🌿", price: 8, hungerDelta: 0, happinessDelta: 15, effect: "play", descZh: "快乐到打滚", descEn: "Rolling-on-the-floor joy" },
  { key: "feather_wand", nameZh: "逗猫棒", nameEn: "Feather Wand", emoji: "🪶", price: 15, hungerDelta: 0, happinessDelta: 30, effect: "play", descZh: "互动运动消耗热量", descEn: "Interactive cardio session" },
];

/** 按 key 查目录（未知 key 返回 undefined，API 校验用）。 */
export function playItemByKey(key: string): PlayItem | undefined {
  return PLAY_ITEMS.find((i) => i.key === key);
}

// ───────────────────────────── 2) 积分经济与养成常量（全部后端执行，前端零逻辑） ─────────────────────────────

/** 每句对话积分成本（超出每日免费额度后，/api/pet/chat 事务扣除，points_log reason='pet_play'）。 */
export const PLAY_CHAT_COST = 1;
/** 每句对话后饥饿度自然消耗（下限 0；与离线衰减叠加）。 */
export const PLAY_CHAT_HUNGER_DECAY = 1;
/** 互动页道具背包来源标记（user_items.source）。 */
export const PLAY_ITEM_SOURCE = "pet_play";
/** 每日免费对话次数（需求五.3：当日 pet_play_logs 中 kind='chat' 行数 < 本值不计费）。 */
export const PET_CHAT_FREE_DAILY = 5;
/** 每日对话总上限（含免费；需求六.2 防刷爆大模型费用，超出 429）。 */
export const PET_CHAT_DAILY_CAP = 100;
/** 单条输入长度上限（需求六.2）。 */
export const PET_CHAT_MAX_LEN = 500;
/** 离线饥饿衰减：每小时 -2（需求四.4；按 last_interacted_at 至今整小时结算）。 */
export const HUNGER_DECAY_PER_HOUR = 2;
/** 饥饿告警阈值（≤ 本值：前端 hungry 情绪 + 提示买粮，prompt 注入「饿」状态）。 */
export const HUNGRY_THRESHOLD = 20;

/**
 * 离线饥饿衰减结算 SQL（需求四.4；UPDATE adoptions 的 SET 子句片段）：
 * 按 last_interacted_at 至今的整小时数 × HUNGER_DECAY_PER_HOUR 衰减，下限 0；
 * 结算后必须同时更新 last_interacted_at = now()（防重复扣减）。
 */
export const HUNGER_SETTLE_SQL = `hunger_level = GREATEST(0, hunger_level - FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(last_interacted_at, now()))) / 3600)::int * ${HUNGER_DECAY_PER_HOUR})`;

// ───────────────────────────── 3) LLM 输出解析（需求三.3 统一结构 + 白名单归一） ─────────────────────────────

/** 统一对话回复契约：大模型只返回 { text, mood, intensity }；action 由 MOOD_ACTION_MAP 推导。 */
export interface PetChatReply {
  text: string;
  mood: PetMood;
  /** 情绪强度 0-2（Rive Number 输入「intensity」；解析缺省 1，越界钳制）。 */
  intensity: 0 | 1 | 2;
  /** 由映射表推导（需求三.2：大模型不返回动画名）。 */
  action: import("@/lib/pets/characters").PetAction;
}

const MOOD_SET = new Set<string>([
  "idle", "happy", "sad", "angry", "hungry", "thinking", "sleepy",
]);

function isMood(v: unknown): v is PetMood {
  return typeof v === "string" && MOOD_SET.has(v);
}

/**
 * 解析 LLM 原始输出为 PetChatReply；无法解析返回 null（调用方走本地兜底）。
 * 容错点：模型可能包裹代码块/前后废话 → 提取第一个 {...} 子串；
 * mood 越界 → 归一 idle（需求三.3 非法值降级）；intensity 缺省 1、钳制 0-2；
 * text 保留（情绪标签宁稳不错）并截断 300 字。
 */
export function parsePetChatResponse(raw: string): PetChatReply | null {
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
  const mood: PetMood = isMood(o.mood) ? o.mood : "idle";
  const n = typeof o.intensity === "number" && Number.isFinite(o.intensity) ? Math.round(o.intensity) : 1;
  const intensity = (n <= 0 ? 0 : n >= 2 ? 2 : n) as 0 | 1 | 2;
  return { text: o.text.trim().slice(0, 300), mood, intensity, action: actionForMood(mood) };
}

// ───────────────────────────── 4) 本地兜底（AI 繁忙/失败时功能永可用，Phase 8 同哲学） ─────────────────────────────

/** 关键词 → 情绪推断（兜底回复的情绪一致性保证；新统一枚举）。 */
export function inferMood(message: string): PetMood {
  const t = message.toLowerCase();
  if (/吃|饿|饭|鱼|罐头|食|\beat\b|\bfood\b|\bhungry\b|\bfish\b/.test(t)) return "hungry";
  if (/睡|困|累|摸鱼|下班|晚安|\bsleep\b|\btired\b|\brest\b|\blazy\b/.test(t)) return "sleepy";
  if (/笨蛋|讨厌|滚|傻|\bstupid\b|\bhate\b|\bshut\b/.test(t)) return "angry";
  if (/难过|伤心|哭|委屈|\bsad\b|\bcry\b|\bupset\b/.test(t)) return "sad";
  if (/为什么|怎么|想|吗|？|\bwhy\b|\bthink\b|\bhow\b|\bwhat\b/.test(t)) return "thinking";
  if (/棒|厉害|喜欢|爱|开心|你好|嗨|早|涨薪|\bgreat\b|\blove\b|\bhappy\b|\bhi\b|\bhello\b|\bhey\b|\bmorning\b|\braise\b/.test(t)) return "happy";
  return "idle";
}

/** 本地兜底回复：按输入推断情绪 + 当前角色台词库随机（永不抛错；台词随角色走——雪豹不再说橘猫话）。 */
export function fallbackPetReply(message: string, locale: string, petType?: string | null): PetChatReply {
  const mood = inferMood(message);
  const c = resolveCharacter(petType);
  const bank = locale === "en" ? c.linesEn : c.linesZh;
  const lines = bank[mood]?.length ? bank[mood] : bank.idle;
  const text = lines[Math.floor(Math.random() * lines.length)];
  return { text, mood, intensity: 1, action: actionForMood(mood) };
}

// ───────────────────────────── 5) 剧场 legacy 侧栏互动（/api/pet/feed 保留兼容） ─────────────────────────────

export interface MovieInteraction {
  kind: "food" | "toy";
  emoji: string;
  /** 价格（积分；/api/pet/feed 后端事务扣除，前端零经济逻辑） */
  cost: number;
  hungerDelta: number;
  happinessDelta: number;
}

/** legacy 直购互动（剧场老客户端兼容；新客户端一律走背包 PLAY_ITEMS + /api/pet/play/buy|use）。 */
export const MOVIE_INTERACTIONS: MovieInteraction[] = [
  { kind: "food", emoji: "🐟", cost: 5, hungerDelta: 25, happinessDelta: 3 },
  { kind: "toy", emoji: "🧸", cost: 8, hungerDelta: 0, happinessDelta: 20 },
];

/** 按 kind 查互动配置（API 校验用；未知 kind → undefined → 400）。 */
export function movieInteractionByKind(kind: string): MovieInteraction | undefined {
  return MOVIE_INTERACTIONS.find((i) => i.kind === kind);
}

// ───────────────────────────── 6) 剧场默认宠物（无 adoption 时自动创建打工橘猫） ─────────────────────────────

/** 默认宠物类型：图鉴猫科物种（官方 PetType 仅 fox/penguin/dog，无 cat——getPet 会 fallback 狐狸）。 */
export const MOVIE_PET_TYPE = "species:persian";
/** 默认宠物名（按请求 locale；用户后续可在灵宠页改名）。 */
export function movieDefaultPetName(locale: string): string {
  return locale === "en" ? "OJ" : "阿橘";
}
