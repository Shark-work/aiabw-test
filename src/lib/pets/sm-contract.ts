/**
 * 宠物状态机契约（通用宠物状态机 · 动画逻辑层，纯数据/纯函数模块）。
 *
 * 动画逻辑与物种外观解耦：本模块只管「状态机怎么动」——情绪枚举 / 动作 /
 * Rive 输入名 / 情绪→动作映射 / 关键词情绪推断；「物种长什么样」（Rive 资产 /
 * 静态立绘 / 场景主题）→ src/lib/pets/species-visuals.ts 注册表。
 *
 * 客户端可安全 import（零 prompt、零 fs、零密钥）。characters.ts（服务端专用）
 * 与 pet-play-config.ts 均 re-export 本模块——单一事实源 + 既有 import 口兼容。
 *
 * Rive 状态机契约（美术交付红线，大小写严格；详见 assets/rive/README.md）：
 *  - 状态机名固定 PetStateMachine；
 *  - Number 输入「emotion」= PET_MOODS 索引序（0-6）；
 *  - Number 输入「intensity」= 情绪强度；
 *  - Trigger 输入 = PET_SM_TRIGGERS 五值，且每个动作播完自动回 idle。
 */

// ───────────────────────────── 1) 情绪 / 动作枚举（全站统一命名） ─────────────────────────────

/** 情绪白名单：LLM 输出 mood/emotion 值域 + Rive 状态机 Number 输入「emotion」（索引序，美术按此绑定）。 */
export const PET_MOODS = [
  "idle",
  "happy",
  "sad",
  "angry",
  "hungry",
  "thinking",
  "sleepy",
] as const;
export type PetMood = (typeof PET_MOODS)[number];

/**
 * 动作白名单（legacy 动作位：道具效果 / 情绪映射推导 / 点击互动）。
 * 契约状态机的 Trigger 输入以 PET_SM_TRIGGERS 为准；旧动作名经 ACTION_TRIGGER_ALIAS 翻译。
 */
export const PET_ACTIONS = [
  "idle",
  "eat",
  "sleep",
  "think",
  "wave",
  "happy",
  "sad",
  "angry",
  "rub",
] as const;
export type PetAction = (typeof PET_ACTIONS)[number];

/**
 * 情绪 → 动作映射表（红线：全站只经本表把情绪翻译成动画动作，
 * 大模型输出契约不含动画名）。
 * 「蹭蹭」rub 为互动动作位（前端点击宠物时直接 fire，契约层别名 = pet，不占情绪位）。
 */
export const MOOD_ACTION_MAP: Record<PetMood, PetAction> = {
  idle: "idle",
  happy: "happy",
  sad: "sad",
  angry: "angry",
  hungry: "eat",
  thinking: "think",
  sleepy: "sleep",
};

/** 情绪 → 动作（映射表唯一入口；未知情绪降级 idle）。 */
export function actionForMood(mood: PetMood): PetAction {
  return MOOD_ACTION_MAP[mood] ?? "idle";
}

// ───────────────────────────── 2) Rive 状态机契约（5 Trigger） ─────────────────────────────

/** 默认/首只契约资产 key（向后兼容常量；物种 → 资产映射以 species-visuals 注册表为准）。 */
export const RIVE_ASSET_NAME = "worker-cat";
/** .riv 内状态机名称约定（美术交付需遵守，大小写严格；详见 assets/rive/README.md）。 */
export const RIVE_STATE_MACHINE = "PetStateMachine";

/**
 * 契约 Trigger 输入（5 个，大小写严格）：pet 被抚摸 / eat 进食 / play 玩耍 / sleep 入睡 / wake 醒来。
 * 契约资产必须为每个 Trigger 配置「播完自动回 idle」的过渡（避免卡在动作帧）。
 */
export const PET_SM_TRIGGERS = ["pet", "eat", "play", "sleep", "wake"] as const;
export type PetSmTrigger = (typeof PET_SM_TRIGGERS)[number];

/**
 * 旧动作名 → 契约 Trigger 别名（向后兼容：蹭蹭 rub = 抚摸 pet；eat/sleep 同名直通）。
 * think/wave/happy/sad/angry 等情绪位由 emotion Number 输入表达，无对应 Trigger，不在本表。
 */
export const ACTION_TRIGGER_ALIAS: Partial<Record<PetAction, PetSmTrigger>> = {
  rub: "pet",
  eat: "eat",
  sleep: "sleep",
};

// ───────────────────────────── 3) 对话回复契约 + 关键词情绪推断（纯函数） ─────────────────────────────

/** 统一对话回复契约：大模型只回文本 + 情绪 + 强度；action 由 MOOD_ACTION_MAP 推导。 */
export interface PetChatReply {
  text: string;
  mood: PetMood;
  /** 情绪强度 0-2（Rive Number 输入「intensity」；解析缺省 1，越界钳制）。 */
  intensity: 0 | 1 | 2;
  /** 由映射表推导（大模型不返回动画名）。 */
  action: PetAction;
}

/** 关键词 → 情绪推断（兜底回复的情绪一致性保证；纯函数，无状态）。 */
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
