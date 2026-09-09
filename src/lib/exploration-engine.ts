/**
 * 宠物旅行日记 v2 · 探索引擎（应用层纯函数）
 *
 * 核心规则（与现有聊天驱动步数系统并行）：
 *   - 免费用户：每天最多 1 次探索，步数 ×1.0
 *   - VIP 用户：每天最多 3 次探索，步数 ×1.5，稀有事件权重翻倍
 *   - 事件库 5 类（postcard / gift / knowledge / encounter / rest）按 weight 抽取
 *   - 步数范围 500-3000，距离 0.3-2.0 km
 *
 * 与 0016_exploration.sql 的 7-map chat-driven 系统不冲突；新功能并行。
 */
export type EventType = "postcard" | "gift" | "knowledge" | "encounter" | "rest";
export type Rarity = "common" | "rare" | "epic";

export const EVENT_TYPES: readonly EventType[] = [
  "postcard",
  "gift",
  "knowledge",
  "encounter",
  "rest",
] as const;

export const RARITY_LEVELS: readonly Rarity[] = ["common", "rare", "epic"] as const;

export const RARE_RARITY_SET: ReadonlySet<Rarity> = new Set(["rare", "epic"]);

/** VIP 权益常量：可在测试中直接 import 验证 */
export const EXPLORATION_V2_CONFIG = {
  FREE_DAILY_LIMIT: 1,
  VIP_DAILY_LIMIT: 3,
  VIP_STEP_MULTIPLIER: 1.5,
  STEPS_MIN: 500,
  STEPS_MAX: 3000,
  DISTANCE_MIN: 0.3,
  DISTANCE_MAX: 2.0,
  VIP_RARE_WEIGHT_BOOST: 2,
} as const;

export type ExplorationEventRow = {
  id: string;
  petCategory: string | null;
  eventType: EventType;
  title: string;
  description: string;
  imageEmoji: string | null;
  rarity: Rarity;
  weight: number;
  requiredEquipment: string | null;
  knowledgeLink: string | null;
  createdAt?: Date;
};

export type ExplorationEventResult = {
  id: string;
  type: EventType;
  title: string;
  description: string;
  emoji: string | null;
  rarity: Rarity;
  isRare: boolean;
  knowledge: KnowledgeSnapshot | null;
};

export type KnowledgeSnapshot = {
  id: string;
  species: string;
  category: string;
  origin: string | null;
  lifespan: string | null;
  weight: string | null;
  traits: string[];
  funFacts: string[];
  habitat: string | null;
  diet: string | null;
  conservationStatus: string | null;
};

export type ExplorationRecordInsert = {
  id: string;
  userId: string;
  petId: string | null;
  eventId: string;
  resultType: EventType;
  resultData: string;
  stepsGained: number;
  distanceGained: number;
  isRare: boolean;
  createdAt: Date;
};

export type ExplorationStartResponse = {
  ok: true;
  event: ExplorationEventResult;
  steps: number;
  distance: number;
  todayCount: number;
  maxCount: number;
  isVip: boolean;
};

export type ExplorationStartError = {
  ok: false;
  code: "SIGN_IN_REQUIRED" | "EXPLORATION_LIMIT" | "SERVER_ERROR";
  error: string;
  todayCount: number;
  maxCount: number;
  isVip: boolean;
};

// ───────────── 1) 容量 / 乘数 ─────────────

export function getMaxExplorations(isVip: boolean): number {
  return isVip ? EXPLORATION_V2_CONFIG.VIP_DAILY_LIMIT : EXPLORATION_V2_CONFIG.FREE_DAILY_LIMIT;
}

export function getStepMultiplier(isVip: boolean): number {
  return isVip ? EXPLORATION_V2_CONFIG.VIP_STEP_MULTIPLIER : 1.0;
}

// ───────────── 2) 事件抽取（加权随机）─────────────

/**
 * 按权重从 events 池中抽取一条。空池报错（调用方负责过滤）。
 * VIP 时稀有（rare/epic）权重 ×2，提升爆率。
 */
export function pickWeightedEvent(
  events: ExplorationEventRow[],
  opts: { isVip?: boolean; random?: () => number } = {},
): ExplorationEventRow {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("pickWeightedEvent: events must be a non-empty array");
  }
  const isVip = opts.isVip ?? false;
  const rand = opts.random ?? Math.random;
  const weights = events.map((e) => {
    const base = Math.max(0, e.weight || 0);
    if (isVip && RARE_RARITY_SET.has(e.rarity)) {
      return base * EXPLORATION_V2_CONFIG.VIP_RARE_WEIGHT_BOOST;
    }
    return base;
  });
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return events[0];
  const r = rand() * total;
  let cum = 0;
  for (let i = 0; i < events.length; i++) {
    cum += weights[i];
    if (r < cum) return events[i];
  }
  return events[events.length - 1];
}

// ───────────── 3) 步数 / 距离生成 ─────────────

/** 生成本次探索的步数：基础区间 500-3000 内的整数，再 ×VIP 倍率。 */
export function generateSteps(
  isVip: boolean,
  opts: { random?: () => number } = {},
): number {
  const rand = opts.random ?? Math.random;
  const range = EXPLORATION_V2_CONFIG.STEPS_MAX - EXPLORATION_V2_CONFIG.STEPS_MIN + 1;
  const base = EXPLORATION_V2_CONFIG.STEPS_MIN + Math.floor(rand() * range);
  return Math.floor(base * getStepMultiplier(isVip));
}

/** 生成本次探索的距离（公里）：0.3-2.0 km，保留 2 位小数，×VIP 倍率。 */
export function generateDistance(
  isVip: boolean,
  opts: { random?: () => number } = {},
): number {
  const rand = opts.random ?? Math.random;
  const range = EXPLORATION_V2_CONFIG.DISTANCE_MAX - EXPLORATION_V2_CONFIG.DISTANCE_MIN;
  const base = EXPLORATION_V2_CONFIG.DISTANCE_MIN + rand() * range;
  const scaled = base * getStepMultiplier(isVip);
  return Math.round(scaled * 100) / 100;
}
// ───────────── 4) 知识库 JSON 解析（DB 列存为 TEXT）─────────────

export function parseAnimalTraits(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function parseAnimalFunFacts(raw: string | null | undefined): string[] {
  return parseAnimalTraits(raw);
}

export function toKnowledgeSnapshot(
  row: Record<string, unknown> | null | undefined,
): KnowledgeSnapshot | null {
  if (!row || typeof row !== "object") return null;
  const get = (a: string, b: string): unknown => row[a] ?? row[b];
  const id = String(get("id", "id") ?? "");
  if (!id) return null;
  const species = String(get("species", "species") ?? "");
  const category = String(get("category", "category") ?? "");
  return {
    id,
    species,
    category,
    origin: (get("origin", "origin") as string | null) ?? null,
    lifespan: (get("lifespan", "lifespan") as string | null) ?? null,
    weight: (get("weight", "weight") as string | null) ?? null,
    traits: parseAnimalTraits((get("traits", "traits") as string | null) ?? null),
    funFacts: parseAnimalFunFacts((get("fun_facts", "funFacts") as string | null) ?? null),
    habitat: (get("habitat", "habitat") as string | null) ?? null,
    diet: (get("diet", "diet") as string | null) ?? null,
    conservationStatus: (get("conservation_status", "conservationStatus") as string | null) ?? null,
  };
}

export function toEventResult(event: ExplorationEventRow): ExplorationEventResult {
  return {
    id: event.id,
    type: event.eventType,
    title: event.title,
    description: event.description,
    emoji: event.imageEmoji ?? null,
    rarity: event.rarity,
    isRare: RARE_RARITY_SET.has(event.rarity),
    knowledge: null,
  };
}

// ───────────── 5) 记录序列化（result_data 存为 JSON 字符串）─────────────

export function serializeResultData(input: {
  title: string;
  description: string;
  emoji: string | null;
  rarity: Rarity;
  knowledgeId?: string | null;
}): string {
  return JSON.stringify({
    title: input.title,
    description: input.description,
    emoji: input.emoji,
    rarity: input.rarity,
    knowledgeId: input.knowledgeId ?? null,
  });
}

export function deserializeResultData(
  raw: string | null | undefined,
): { title: string; description: string; emoji: string | null; rarity: Rarity; knowledgeId: string | null } {
  if (!raw) {
    return { title: "", description: "", emoji: null, rarity: "common", knowledgeId: null };
  }
  try {
    const v = JSON.parse(raw);
    return {
      title: typeof v?.title === "string" ? v.title : "",
      description: typeof v?.description === "string" ? v.description : "",
      emoji: typeof v?.emoji === "string" ? v.emoji : null,
      rarity: (["common", "rare", "epic"] as const).includes(v?.rarity) ? v.rarity : "common",
      knowledgeId: typeof v?.knowledgeId === "string" ? v.knowledgeId : null,
    };
  } catch {
    return { title: "", description: "", emoji: null, rarity: "common", knowledgeId: null };
  }
}
