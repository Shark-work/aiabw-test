import { generateText } from "ai";
import type { UIMessage } from "ai";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { adoptions } from "@/db/schema";
import { getModel } from "@/lib/get-model";

/**
 * 长期记忆：提取、去重存储、注入。
 *
 * storage 格式（adoptions.memory_context 存 JSON 字符串）：
 *   {"facts": [{"text": "用户喜欢喝咖啡", "ts": 1690000000000}, ...]}
 *
 * 去重策略：
 *   - 完全一致（归一化后）→ 去重（刷新时间戳，提升“提及频率”权重）；
 *   - 新事实包含旧事实（或反之，如“不喜欢咖啡” vs “喜欢咖啡”）→ 视为更新，替换旧条目；
 *   - 其余 → 追加。
 * 上限：按字符数近似 token 上限，超出后按时间权重丢弃最旧记忆。
 */

export type MemoryFact = { text: string; ts: number };
export type MemoryStore = { facts: MemoryFact[] };

/** 近似 token 上限（中文约 1 字符 ≈ 1 token） */
const MEMORY_MAX_CHARS = 3000;
/** 提取模型最大输出 */
const EXTRACT_MAX_OUTPUT_TOKENS = 500;

const EXTRACT_PROMPT = `你是一个长期记忆提取助手。你的任务是从对话中提取"关于用户"的关键事实、偏好和重要信息（例如：姓名/昵称、爱好、喜好、重要经历、宠物名字等）。
要求：
1. 每条事实必须具体、完整、可独立理解（如"用户喜欢喝咖啡"，而不是"喜欢咖啡"）。
2. 忽略问候、客套、天气、与用户无关的临时内容。
3. 只输出 JSON，格式：{"facts": ["事实1", "事实2"]}。不要输出任何其他文字。
4. 没有值得记忆的新信息时输出 {"facts": []}。

示例1：
对话：
用户：你好，我叫小明，平时喜欢喝咖啡，养了一只叫旺财的狗。
助手：很高兴认识你，小明！
输出：{"facts": ["用户叫小明", "用户喜欢喝咖啡", "用户养了一只叫旺财的狗"]}

示例2：
对话：
用户：今天天气不错。
助手：是啊，很适合出门散步。
输出：{"facts": []}

现在分析下面的对话并只输出 JSON：
对话：`;

export function parseMemoryStore(raw: string | null | undefined): MemoryStore {
  if (!raw) return { facts: [] };
  try {
    const data = JSON.parse(raw) as { facts?: unknown[] };
    if (Array.isArray(data?.facts)) {
      return {
        facts: data.facts
          .filter(
            (f): f is { text: string; ts?: unknown } =>
              !!f && typeof (f as { text?: unknown }).text === "string",
          )
          .map((f) => ({
            text: f.text,
            ts: typeof f.ts === "number" ? f.ts : Date.now(),
          })),
      };
    }
  } catch {
    // 解析失败视为无记忆
  }
  return { facts: [] };
}

export function serializeMemoryStore(store: MemoryStore): string {
  return JSON.stringify({ facts: store.facts });
}

/** 归一化：小写 + 去空白/标点，用于语义近似比较 */
export function normalizeFact(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s，。！？、；：“”‘’"'.,!?;:（）()\[\]【】\-—_…~～\u3000]+/g, "")
    .trim();
}

/** 合并新事实（去重 / 更新替换 / 追加）+ 按时间权重裁剪到上限 */
export function mergeFacts(
  existing: MemoryFact[],
  newFacts: string[],
  now: number = Date.now(),
): MemoryFact[] {
  const result = existing.map((f) => ({ ...f }));

  for (const raw of newFacts) {
    const text = raw.trim();
    const norm = normalizeFact(text);
    if (!norm) continue;

    // 1) 完全一致 → 去重，仅刷新时间戳（提升提及权重）
    const exactIdx = result.findIndex((f) => normalizeFact(f.text) === norm);
    if (exactIdx >= 0) {
      result[exactIdx] = { ...result[exactIdx], ts: now };
      continue;
    }

    // 2) 语义更新：新事实与旧事实互相包含（如“不喜欢咖啡”替换“喜欢咖啡”）→ 替换
    const similarIdx = result.findIndex((f) => {
      const nf = normalizeFact(f.text);
      return nf.length > 0 && (norm.includes(nf) || nf.includes(norm));
    });
    if (similarIdx >= 0) {
      result[similarIdx] = { text, ts: now };
      continue;
    }

    // 3) 新信息 → 追加
    result.push({ text, ts: now });
  }

  // 上限控制：按时间权重（ts 升序）丢弃最旧记忆，直到字符数不超限
  result.sort((a, b) => a.ts - b.ts);
  let total = result.reduce((s, f) => s + f.text.length, 0);
  while (total > MEMORY_MAX_CHARS && result.length > 0) {
    total -= result[0].text.length;
    result.shift();
  }
  return result;
}

/** 取最近一条用户消息的文本 */
function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const part = (m.parts ?? []).find((p) => p.type === "text") as
      | { text?: string }
      | undefined;
    if (part?.text) return part.text;
  }
  return "";
}

/** 调用模型提取关键事实（复用当前模型；JSON 容错解析） */
async function extractFacts(userText: string, assistantText: string): Promise<string[]> {
  const convo = [
    `用户：${userText}`,
    assistantText ? `助手：${assistantText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  if (!convo.trim()) return [];

  const { text } = await generateText({
    model: getModel(),
    temperature: 0.2,
    maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS,
    system: EXTRACT_PROMPT,
    prompt: `${convo}\n\n只输出 JSON：`,
  });

  const t = text.trim();
  try {
    const data = JSON.parse(t) as { facts?: unknown[] };
    if (Array.isArray(data?.facts)) {
      return data.facts.filter((x): x is string => typeof x === "string");
    }
  } catch {
    // 容错：尝试提取首个 JSON 对象
  }
  const block = t.match(/\{[\s\S]*\}/);
  if (block) {
    try {
      const data = JSON.parse(block[0]) as { facts?: unknown[] };
      if (Array.isArray(data?.facts)) {
        return data.facts.filter((x): x is string => typeof x === "string");
      }
    } catch {
      // 忽略解析失败
    }
  }
  return [];
}

/**
 * 对话流结束后调用：读取现有记忆 → 提取新事实 → 合并去重 → 写回。
 * 无新信息或无 adoptionId 时直接返回。
 */
export async function updateMemory(
  adoptionId: string | undefined,
  messages: UIMessage[],
  assistantText: string,
): Promise<void> {
  if (!adoptionId) return;
  const userText = lastUserText(messages);
  if (!userText) return;

  const facts = await extractFacts(userText, assistantText);
  if (facts.length === 0) return;

  const [adoption] = await db
    .select({ memoryContext: adoptions.memoryContext })
    .from(adoptions)
    .where(eq(adoptions.id, adoptionId))
    .limit(1);
  if (!adoption) return;

  const store = parseMemoryStore(adoption.memoryContext);
  const merged = mergeFacts(store.facts, facts);

  // 文本未发生变化则不写库
  const unchanged =
    merged.length === store.facts.length &&
    merged.every((f, i) => f.text === store.facts[i].text);
  if (unchanged) return;

  await db
    .update(adoptions)
    .set({ memoryContext: serializeMemoryStore({ facts: merged }) })
    .where(eq(adoptions.id, adoptionId));
}

/** 把长期记忆渲染为注入 System Prompt 的段落；无记忆返回空串 */
export function buildMemorySection(memoryContext: string | null | undefined): string {
  const store = parseMemoryStore(memoryContext);
  if (store.facts.length === 0) return "";
  const lines = store.facts.map((f) => `- ${f.text}`).join("\n");
  return (
    "# 关于主人的长期记忆\n" +
    "以下是关于用户的长期记忆，请在回复时自然参考这些信息，不要生硬背诵：\n" +
    lines
  );
}
