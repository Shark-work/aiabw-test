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

export type MemoryCategory = "user" | "pet";
export type MemoryFact = {
  text: string;
  ts: number;
  /** 事实分类：user=关于用户，pet=关于宠物 */
  category?: MemoryCategory;
};
export type MemoryStore = {
  facts: MemoryFact[];
  /** 已触发记忆提取的对话轮次计数（用于降频） */
  extractCounter?: number;
};

/** 近似 token 上限（中文约 1 字符 ≈ 1 token） */
export const MEMORY_MAX_CHARS = 3000;
/** 提取模型最大输出 */
const EXTRACT_MAX_OUTPUT_TOKENS = 500;
/** 每 N 条对话消息才执行一次记忆提取（省模型调用） */
const MEMORY_EXTRACT_EVERY = Math.max(
  1,
  Number(process.env.MEMORY_EXTRACT_EVERY ?? 3) || 3,
);
/** 记忆提取专用模型（可选；默认跟随主模型） */
const MEMORY_EXTRACT_MODEL = process.env.MEMORY_EXTRACT_MODEL ?? undefined;

const EXTRACT_PROMPT = `你是一个长期记忆提取助手。你的任务是从对话中提取"关于用户"的关键事实、偏好和重要信息（例如：姓名/昵称、爱好、喜好、重要经历、宠物名字等）。
要求：
1. 每条事实必须具体、完整、可独立理解（如"用户喜欢喝咖啡"，而不是"喜欢咖啡"）。
2. 忽略问候、客套、天气、与用户无关的临时内容。
3. 只输出 JSON，格式：{"facts": [{"text": "用户喜欢喝咖啡", "category": "user"}, {"text": "宠物叫旺财", "category": "pet"}]}。
   category 取值：user（关于用户本人的信息）、pet（关于宠物/陪伴角色的信息）。不要输出任何其他文字。
4. 没有值得记忆的新信息时输出 {"facts": []}。

示例1：
对话：
用户：你好，我叫小明，平时喜欢喝咖啡，养了一只叫旺财的狗。
助手：很高兴认识你，小明！
输出：{"facts": [{"text": "用户叫小明", "category": "user"}, {"text": "用户喜欢喝咖啡", "category": "user"}, {"text": "用户养了一只叫旺财的狗", "category": "pet"}]}

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
    const data = JSON.parse(raw) as { facts?: unknown[]; extractCounter?: unknown };
    if (Array.isArray(data?.facts)) {
      return {
        facts: data.facts
          .filter(
            (f): f is { text: string; ts?: unknown; category?: unknown } =>
              !!f && typeof (f as { text?: unknown }).text === "string",
          )
          .map((f) => ({
            text: f.text,
            ts: typeof f.ts === "number" ? f.ts : Date.now(),
            category:
              f.category === "pet" || f.category === "user"
                ? f.category
                : undefined,
          })),
        extractCounter:
          typeof data.extractCounter === "number" ? data.extractCounter : 0,
      };
    }
  } catch {
    // 解析失败视为无记忆
  }
  return { facts: [] };
}

export function serializeMemoryStore(store: MemoryStore): string {
  return JSON.stringify({
    facts: store.facts.map((f) => ({
      text: f.text,
      ts: f.ts,
      ...(f.category ? { category: f.category } : {}),
    })),
    extractCounter: store.extractCounter ?? 0,
  });
}

/** 归一化：小写 + 去空白/标点，用于语义近似比较 */
export function normalizeFact(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s，。！？、；：“”‘’"'.,!?;:（）()\[\]【】\-—_…~～\u3000]+/g, "")
    .trim();
}

/** 宠物相关关键词（启发式分类兜底） */
const PET_KEYWORDS = [
  "宠物",
  "猫",
  "狗",
  "企鹅",
  "狐狸",
  "兔",
  "鸭",
  "鹦鹉",
  "仓鼠",
  "金鱼",
  "养了",
  "它叫",
  "抱抱狐",
  "小企鹅",
  "修勾",
];

/** 启发式分类：提到宠物/养宠相关内容 → pet，否则 user */
export function classifyFact(text: string): MemoryCategory {
  const t = text.toLowerCase();
  return PET_KEYWORDS.some((k) => t.includes(k)) ? "pet" : "user";
}

/** 合并新事实（去重 / 更新替换 / 追加）+ 按时间权重裁剪到上限 */
export function mergeFacts(
  existing: MemoryFact[],
  newFacts: (string | { text: string; category?: MemoryCategory })[],
  now: number = Date.now(),
): MemoryFact[] {
  const result = existing.map((f) => ({ ...f }));

  for (const raw of newFacts) {
    const text = (typeof raw === "string" ? raw : raw.text).trim();
    const norm = normalizeFact(text);
    if (!norm) continue;
    const category =
      typeof raw === "string" ? classifyFact(text) : raw.category ?? classifyFact(text);

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
      result[similarIdx] = { text, ts: now, category };
      continue;
    }

    // 3) 新信息 → 追加
    result.push({ text, ts: now, category });
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

/** 解析提取结果：兼容旧格式（字符串数组）和新格式（{text, category} 数组） */
function parseFactsResult(facts: unknown[]): { text: string; category?: MemoryCategory }[] {
  const out: { text: string; category?: MemoryCategory }[] = [];
  for (const f of facts) {
    if (typeof f === "string") {
      out.push({ text: f, category: classifyFact(f) });
    } else if (f && typeof (f as { text?: unknown }).text === "string") {
      const obj = f as { text: string; category?: unknown };
      out.push({
        text: obj.text,
        category: obj.category === "pet" ? "pet" : obj.category === "user" ? "user" : classifyFact(obj.text),
      });
    }
  }
  return out;
}

/** 调用模型提取关键事实（复用当前模型；JSON 容错解析） */
async function extractFacts(
  userText: string,
  assistantText: string,
): Promise<{ text: string; category?: MemoryCategory }[]> {
  const convo = [
    `用户：${userText}`,
    assistantText ? `助手：${assistantText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  if (!convo.trim()) return [];

  const { text } = await generateText({
    model: getModel(MEMORY_EXTRACT_MODEL),
    temperature: 0.2,
    maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS,
    system: EXTRACT_PROMPT,
    prompt: `${convo}\n\n只输出 JSON：`,
  });

  const t = text.trim();
  try {
    const data = JSON.parse(t) as { facts?: unknown[] };
    if (Array.isArray(data?.facts)) {
      return parseFactsResult(data.facts);
    }
  } catch {
    // 容错：尝试提取首个 JSON 对象
  }
  const block = t.match(/\{[\s\S]*\}/);
  if (block) {
    try {
      const data = JSON.parse(block[0]) as { facts?: unknown[] };
      if (Array.isArray(data?.facts)) {
        return parseFactsResult(data.facts);
      }
    } catch {
      // 忽略解析失败
    }
  }
  return [];
}

/**
 * 对话流结束后调用：读取现有记忆 → （按频率）提取新事实 → 合并去重 → 写回。
 * 每 MEMORY_EXTRACT_EVERY 条消息才调用一次提取模型，其余只推进计数。
 */
export async function updateMemory(
  adoptionId: string | undefined,
  messages: UIMessage[],
  assistantText: string,
): Promise<void> {
  if (!adoptionId) return;

  const [adoption] = await db
    .select({ memoryContext: adoptions.memoryContext })
    .from(adoptions)
    .where(eq(adoptions.id, adoptionId))
    .limit(1);
  if (!adoption) return;

  const store = parseMemoryStore(adoption.memoryContext);
  store.extractCounter = (store.extractCounter ?? 0) + 1;

  // 降频：未到提取节点则只保存计数，不调用模型
  if (store.extractCounter % MEMORY_EXTRACT_EVERY !== 0) {
    await db
      .update(adoptions)
      .set({ memoryContext: serializeMemoryStore(store) })
      .where(eq(adoptions.id, adoptionId));
    return;
  }

  const userText = lastUserText(messages);
  if (userText) {
    const facts = await extractFacts(userText, assistantText);
    store.facts = mergeFacts(store.facts, facts);
  }

  await db
    .update(adoptions)
    .set({ memoryContext: serializeMemoryStore(store) })
    .where(eq(adoptions.id, adoptionId));
}

/** 读取某宠物的记忆（用于可视化/管理） */
export async function readMemory(
  adoptionId: string,
): Promise<{ facts: MemoryFact[]; usedChars: number; maxChars: number }> {
  const [adoption] = await db
    .select({ memoryContext: adoptions.memoryContext })
    .from(adoptions)
    .where(eq(adoptions.id, adoptionId))
    .limit(1);
  const store = parseMemoryStore(adoption?.memoryContext);
  return {
    facts: store.facts,
    usedChars: store.facts.reduce((s, f) => s + f.text.length, 0),
    maxChars: MEMORY_MAX_CHARS,
  };
}

/** 删除某条记忆；返回删除后的事实列表，未找到返回 null */
export async function deleteMemoryFact(
  adoptionId: string,
  text: string,
): Promise<MemoryFact[] | null> {
  const [adoption] = await db
    .select({ memoryContext: adoptions.memoryContext })
    .from(adoptions)
    .where(eq(adoptions.id, adoptionId))
    .limit(1);
  if (!adoption) return null;

  const store = parseMemoryStore(adoption.memoryContext);
  const before = store.facts.length;
  store.facts = store.facts.filter((f) => f.text !== text);
  if (store.facts.length === before) return null;

  await db
    .update(adoptions)
    .set({ memoryContext: serializeMemoryStore(store) })
    .where(eq(adoptions.id, adoptionId));
  return store.facts;
}

/** 清空某宠物的全部记忆 */
export async function clearMemory(adoptionId: string): Promise<void> {
  await db
    .update(adoptions)
    .set({ memoryContext: null })
    .where(eq(adoptions.id, adoptionId));
}

/** 手动新增一条记忆；返回新增后的事实列表 */
export async function addMemoryFact(
  adoptionId: string,
  text: string,
  category?: MemoryCategory,
): Promise<MemoryFact[]> {
  const [adoption] = await db
    .select({ memoryContext: adoptions.memoryContext })
    .from(adoptions)
    .where(eq(adoptions.id, adoptionId))
    .limit(1);
  if (!adoption) return [];

  const store = parseMemoryStore(adoption.memoryContext);
  store.facts = mergeFacts(store.facts, [{ text, category }]);
  await db
    .update(adoptions)
    .set({ memoryContext: serializeMemoryStore(store) })
    .where(eq(adoptions.id, adoptionId));
  return store.facts;
}

/** 编辑一条记忆；返回编辑后的事实列表，未找到旧条目返回 null */
export async function updateMemoryFact(
  adoptionId: string,
  oldText: string,
  text: string,
  category?: MemoryCategory,
): Promise<MemoryFact[] | null> {
  const [adoption] = await db
    .select({ memoryContext: adoptions.memoryContext })
    .from(adoptions)
    .where(eq(adoptions.id, adoptionId))
    .limit(1);
  if (!adoption) return null;

  const store = parseMemoryStore(adoption.memoryContext);
  const idx = store.facts.findIndex((f) => f.text === oldText);
  if (idx < 0) return null;

  store.facts[idx] = { text, ts: Date.now(), category: category ?? classifyFact(text) };
  await db
    .update(adoptions)
    .set({ memoryContext: serializeMemoryStore(store) })
    .where(eq(adoptions.id, adoptionId));
  return store.facts;
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
