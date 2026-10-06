/**
 * Phase 8 · LLM 降级策略（计划 9.2「降级策略：高峰期限速非关键 AI 调用，预期节省 20-30%」
 * + Phase 8 指令 2「错误自动重试机制 / 备用模型切换逻辑」）。
 *
 * 三层防护（按调用顺序）：
 *  1) 并发限速：实例级在途计数（AI_MAX_CONCURRENCY，默认 6）——高峰期非关键调用
 *     （发帖/起名建议等）直接抛 AiBusyError，调用方走模板兜底，零成本等待；
 *  2) 响应缓存：generateCached() 先查 ai_response_cache，命中即返回（零 LLM 成本）；
 *  3) 跨 provider 重试：generateWithFallback() 按 getModelCandidates() 优先级逐个
 *     尝试，单 provider 失败（401/超时/5xx）自动切换下一个；全部失败抛 AggregateError。
 *
 * 注意：聊天 /api/chat 是流式 + 工具调用 + 千人千面 system prompt，不走本模块
 * （缓存命中率趋零且 SSE 重试语义复杂）；其成本由每日 quota（既有）与限流（rate-limit）控制。
 */
import { generateText } from "ai";

import { buildChatModel, getModelCandidates } from "./get-model";
import { getCachedAiResponse, setCachedAiResponse } from "./ai-cache";

/** 高峰期并发占满信号：调用方应直接走本地兜底，不排队等待。 */
export class AiBusyError extends Error {
  constructor() {
    super("AI concurrency limit reached");
    this.name = "AiBusyError";
  }
}

/** 实例级在途并发上限（环境变量可调；serverless 下为单实例口径，足够削峰）。 */
export const AI_MAX_CONCURRENCY = Math.max(
  1,
  Number(process.env.AI_MAX_CONCURRENCY) || 6,
);

let inFlight = 0;

/** 当前在途 AI 调用数（监控用）。 */
export function aiInFlight(): number {
  return inFlight;
}

/** 尝试占用一个并发槽；占满返回 false（不阻塞）。 */
export function tryAcquireAiSlot(): boolean {
  if (inFlight >= AI_MAX_CONCURRENCY) return false;
  inFlight += 1;
  return true;
}

/** 释放并发槽（必须在 finally 中调用）。 */
export function releaseAiSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
}

export interface GenerateOptions {
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** 覆盖默认模型名（需与 provider 兼容，一般跟随主模型即可）。 */
  modelName?: string;
}

export interface FallbackResult {
  text: string;
  /** 实际出文的 provider id（deepseek/openai/bailian）。 */
  provider: string;
  /** 尝试次数（>1 表示发生了降级切换）。 */
  attempts: number;
}

/** 跨 provider 顺序重试：第一个成功的 provider 出文；全部失败抛 AggregateError。 */
export async function generateWithFallback(
  opts: GenerateOptions,
): Promise<FallbackResult> {
  const candidates = getModelCandidates();
  if (candidates.length === 0) {
    throw new Error("no AI provider configured");
  }
  const errors: unknown[] = [];
  for (const c of candidates) {
    try {
      const { text } = await generateText({
        model: buildChatModel(c, opts.modelName),
        system: opts.system,
        prompt: opts.prompt,
        temperature: opts.temperature,
        maxOutputTokens: opts.maxOutputTokens,
      });
      if (text && text.trim()) {
        return { text, provider: c.id, attempts: errors.length + 1 };
      }
      errors.push(new Error(`${c.id}: empty response`));
    } catch (err) {
      errors.push(err);
      console.error(
        `[llm-fallback] provider ${c.id} failed${c === candidates[candidates.length - 1] ? " (last)" : ", switching"}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  throw new AggregateError(errors, "all AI providers failed");
}

/** 并发限速 + 跨 provider 降级（无缓存——上下文高随机性的调用用本入口，如社媒发帖）。 */
export async function generateThrottled(opts: GenerateOptions): Promise<FallbackResult> {
  if (!tryAcquireAiSlot()) throw new AiBusyError();
  try {
    return await generateWithFallback(opts);
  } finally {
    releaseAiSlot();
  }
}

export interface CachedGenerateOptions extends GenerateOptions {
  /** 缓存业务域（name-suggestions 等），决定缓存 key 前缀与统计分组。 */
  scope: string;
  /** 缓存有效期（天），默认 7。 */
  cacheTtlDays?: number;
}

export interface CachedGenerateResult {
  text: string;
  /** cache=缓存命中（零 LLM 成本）；ai=实时调用。 */
  source: "cache" | "ai";
  provider?: string;
}

/**
 * 缓存 + 并发限速 + 跨 provider 降级组合入口（非关键 generateText 调用的统一路径）。
 * 抛出：AiBusyError（高峰占满）/ AggregateError（全 provider 失败）——调用方负责兜底。
 */
export async function generateCached(
  opts: CachedGenerateOptions,
): Promise<CachedGenerateResult> {
  const cachePrompt = `${opts.system}\n${opts.prompt}`;
  const cached = await getCachedAiResponse(opts.scope, cachePrompt);
  if (cached) return { text: cached, source: "cache" };

  if (!tryAcquireAiSlot()) throw new AiBusyError();
  try {
    const r = await generateWithFallback(opts);
    // 写缓存失败仅记日志，不影响返回
    void setCachedAiResponse(opts.scope, cachePrompt, r.text, opts.cacheTtlDays ?? 7);
    return { text: r.text, source: "ai", provider: r.provider };
  } finally {
    releaseAiSlot();
  }
}
