/**
 * 宠物对话意图情绪解析器（通用状态机 · 对话驱动层，服务端专用）。
 *
 * 解析链（命中即短路，成本从 0 到 LLM 递增）：
 *  1) 本地关键词匹配（INTENT_KEYWORDS 配置表）→ 零 token，回复取角色台词库对应情绪一条；
 *  2) 未命中 → 大模型严格契约 JSON { intent, emotion, intensity, reply }
 *     （复用 llm-fallback 并发限速 + 跨 provider 降级；5s 超时；契约段由角色 prompt 注入）；
 *  3) LLM 非法 JSON / 超时 / 抛错 → 降级链：inferMood 关键词情绪 + 角色台词库；
 *     关键词也无命中 → 默认 { intent: "idle", emotion: "thinking", intensity: 0.3 }。
 *  4) 养成状态修正（覆盖模型判断）：饥饿度 ≤ HUNGRY_THRESHOLD → emotion=hungry；
 *     距上次互动 ≥ LONG_ABSENCE_HOURS → emotion=sleepy（久别重逢，没睡醒）。
 *
 * 可观测：返回 source（keyword/llm/fallback）+ llmMs + tokens，由 /api/pet/chat 落 pet_play_logs。
 */

import { resolveCharacter, type PetCharacter } from "@/lib/pets/characters";
import { generateThrottled } from "@/lib/llm-fallback";
import { inferMood, PET_MOODS, type PetMood } from "@/lib/pets/sm-contract";
import { HUNGRY_THRESHOLD, LONG_ABSENCE_HOURS } from "@/lib/pet-play-config";

// ───────────────────────────── 1) 意图类型与关键词配置表 ─────────────────────────────

/** 互动意图（契约 Trigger 五值 + idle；大模型契约字段 intent 的值域）。 */
export const PET_INTENTS = ["idle", "pet", "eat", "play", "sleep", "wake"] as const;
export type PetIntent = (typeof PET_INTENTS)[number];

export interface IntentResolution {
  intent: PetIntent;
  emotion: PetMood;
  /** 情绪强度 0-1（Rive Number 输入「intensity」）。 */
  intensity: number;
  /** 回复文本（关键词/降级 = 角色台词库；LLM = 模型原文）。 */
  reply: string;
  /** 解析来源：keyword 零成本 / llm 大模型 / fallback 降级。 */
  source: "keyword" | "llm" | "fallback";
  /** LLM 耗时毫秒（keyword 路径无 LLM 调用 → undefined）。 */
  llmMs?: number;
  /** LLM token 估算（仅 llm 路径）。 */
  tokens?: number;
}

interface IntentKeywordRule {
  intent: Exclude<PetIntent, "idle">;
  emotion: PetMood;
  intensity: number;
  pattern: RegExp;
}

/**
 * 关键词 → 意图/情绪配置表（自上而下首个命中生效；映射走配置，组件零硬编码）。
 * 英文词用 \b 词边界防误伤（如 pat 不匹配 pattern）。
 */
export const INTENT_KEYWORDS: readonly IntentKeywordRule[] = [
  { intent: "pet", emotion: "happy", intensity: 0.8, pattern: /摸摸|摸头|撸|揉揉|抱抱|拍拍|亲一下|\b(?:pat|pet|rub|stroke|hug|cuddle)\b/i },
  { intent: "eat", emotion: "hungry", intensity: 0.7, pattern: /喂你|喂食|吃点|吃饭|开饭|请你?吃|罐头|小鱼干|零食|饿了么|饿了吗|\b(?:feed|food|snack|treat)\b/i },
  { intent: "play", emotion: "happy", intensity: 0.9, pattern: /陪你玩|一起玩|玩球|玩耍|玩游戏|逗你|\b(?:play|game)\b/i },
  { intent: "sleep", emotion: "sleepy", intensity: 0.6, pattern: /晚安|去睡|睡觉|该睡了|做个好梦|good\s*night|go to sleep|sleep well/i },
  { intent: "wake", emotion: "idle", intensity: 0.4, pattern: /早上好|早安|起床|醒醒|醒一醒|good\s*morning|wake up/i },
];

/** 关键词匹配（首个命中生效；未命中 → null 走 LLM）。 */
export function matchKeywordIntent(
  message: string,
): Pick<IntentResolution, "intent" | "emotion" | "intensity"> | null {
  const t = message.trim();
  if (!t) return null;
  for (const rule of INTENT_KEYWORDS) {
    if (rule.pattern.test(t)) {
      return { intent: rule.intent, emotion: rule.emotion, intensity: rule.intensity };
    }
  }
  return null;
}

// ───────────────────────────── 2) LLM 严格契约解析 ─────────────────────────────

const INTENT_SET = new Set<string>(PET_INTENTS);
const MOOD_SET = new Set<string>(PET_MOODS);

/**
 * 严格契约 JSON 解析：{ intent, emotion, intensity, reply }。
 * 容错：```json 包裹/前后废话 → 提取首个 {...}；intent/emotion 越界 → idle；intensity 钳 0-1；
 * 兼容旧字段 text/mood（模型偶发漂移）；reply 缺失 = 不可修复 → null（走降级链）。
 */
export function parseIntentResponse(raw: string): Omit<IntentResolution, "source"> | null {
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
  const replyRaw = o.reply ?? o.text;
  if (typeof replyRaw !== "string" || !replyRaw.trim()) return null;
  const intent: PetIntent =
    typeof o.intent === "string" && INTENT_SET.has(o.intent) ? (o.intent as PetIntent) : "idle";
  const emoRaw = o.emotion ?? o.mood;
  const emotion: PetMood =
    typeof emoRaw === "string" && MOOD_SET.has(emoRaw) ? (emoRaw as PetMood) : "idle";
  const n = typeof o.intensity === "number" && Number.isFinite(o.intensity) ? o.intensity : 0.5;
  return {
    intent,
    emotion,
    intensity: Math.min(1, Math.max(0, n)),
    reply: replyRaw.trim().slice(0, 300),
  };
}

// ───────────────────────────── 3) 解析入口（关键词 → LLM → 降级 → 养成修正） ─────────────────────────────

export interface ResolveIntentInput {
  message: string;
  locale: string;
  petType: string;
  petName: string;
  happiness: number;
  hungerLevel: number;
  /** 距上次互动小时数（路由在刷新 last_interacted_at 前捕获）。 */
  absenceHours?: number;
}

export interface ResolveIntentDeps {
  /** 测试注入；缺省 = llm-fallback generateThrottled。 */
  generate?: typeof generateThrottled;
  /** LLM 超时毫秒（默认 5000；超时走降级链）。 */
  timeoutMs?: number;
}

function pickLine(c: PetCharacter, mood: PetMood, locale: string): string {
  const bank = locale === "en" ? c.linesEn : c.linesZh;
  const lines = bank[mood]?.length ? bank[mood] : bank.idle;
  return lines[Math.floor(Math.random() * lines.length)];
}

export async function resolvePetIntent(
  input: ResolveIntentInput,
  deps: ResolveIntentDeps = {},
): Promise<IntentResolution> {
  const character = resolveCharacter(input.petType);
  let resolved: IntentResolution;

  // 1) 关键词短路（零 token）：回复取角色台词库对应情绪（人设不崩、成本为零）
  const kw = matchKeywordIntent(input.message);
  if (kw) {
    resolved = { ...kw, reply: pickLine(character, kw.emotion, input.locale), source: "keyword" };
  } else {
    // 2) LLM 严格契约（5s 超时；超时/非法 JSON/抛错 → 3) 降级链）
    const generate = deps.generate ?? generateThrottled;
    const timeoutMs = deps.timeoutMs ?? 5000;
    const system = character.buildSystemPrompt({
      petName: input.petName,
      happiness: input.happiness,
      hungerLevel: input.hungerLevel,
    });
    const t0 = Date.now();
    let parsed: Omit<IntentResolution, "source"> | null = null;
    let llmMs: number | undefined;
    let tokens: number | undefined;
    try {
      const r = await Promise.race([
        generate({ system, prompt: input.message, temperature: 0.9, maxOutputTokens: 220 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("pet intent llm timeout")), timeoutMs),
        ),
      ]);
      llmMs = Date.now() - t0;
      tokens = r.tokens ?? Math.ceil((system.length + input.message.length + r.text.length) / 4);
      parsed = parseIntentResponse(r.text);
      if (!parsed) console.warn("[pet/intent] invalid contract JSON, degrade to fallback");
    } catch (err) {
      llmMs = Date.now() - t0;
      console.warn("[pet/intent] llm unavailable, degrade:", err instanceof Error ? err.message : err);
    }
    if (parsed) {
      resolved = { ...parsed, source: "llm", llmMs, tokens };
    } else {
      // 3) 降级链：关键词情绪结果 + 台词库；也无命中 → 默认 { idle, thinking, 0.3 }
      const mood = inferMood(input.message);
      if (mood === "idle") {
        resolved = {
          intent: "idle",
          emotion: "thinking",
          intensity: 0.3,
          reply: pickLine(character, "thinking", input.locale),
          source: "fallback",
          llmMs,
          tokens,
        };
      } else {
        resolved = {
          intent: "idle",
          emotion: mood,
          intensity: 0.5,
          reply: pickLine(character, mood, input.locale),
          source: "fallback",
          llmMs,
          tokens,
        };
      }
    }
  }

  // 4) 养成状态修正（覆盖模型判断）：饥饿 / 久别重逢
  if (input.hungerLevel <= HUNGRY_THRESHOLD) {
    resolved = { ...resolved, emotion: "hungry", intensity: Math.max(resolved.intensity, 0.6) };
  } else if ((input.absenceHours ?? 0) >= LONG_ABSENCE_HOURS) {
    resolved = { ...resolved, emotion: "sleepy" };
  }
  return resolved;
}
