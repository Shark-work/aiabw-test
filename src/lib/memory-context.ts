/**
 * 宠物长期记忆 · 提取 + 召回（src/lib/memory-context.ts）
 *
 * 与 src/lib/memory.ts 互不冲突：memory.ts 处理 adoptions.memory_context（JSON）
 * 早期自由格式的「事实列表」；本模块处理 pet_memories 表（结构化：类型/重要度/召回统计）
 * 仅 VIP 可用，能力来源 src/lib/memory-gate.hasMemoryAccess()。
 *
 * - extractMemories(userId, messages)：对话后异步调用豆包提取 4 类记忆（preference/event/fact/emotion），
 *   经去重后写入 pet_memories。
 * - recallMemory({ userId, query })：从 pet_memories 中按 importance 倒序 + 7 天内加权召回 3-5 条，
 *   返回渲染好的可注入 System Prompt 段落。
 */
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { UIMessage } from "ai";

import { db } from "@/db/client";
import { petMemories } from "@/db/schema";
import { generateText } from "ai";
import { getModel } from "@/lib/get-model";

/** 4 类记忆类型，与 drizzle/0019_pet_memories.sql 的 CHECK 约束对齐 */
export type MemoryType = "preference" | "event" | "fact" | "emotion";

export interface PetMemoryRow {
  id: string;
  userId: string;
  petId: string | null;
  memoryType: MemoryType;
  content: string;
  sourceMessage: string | null;
  importance: number;
  timesRecalled: number;
  lastRecalledAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}



/** 召回时返回的渲染段落 + 命中 id（供调用方按需做副作用） */
export interface RecalledMemory {
  row: PetMemoryRow;
  /** 关键词命中数；0-1；无 query 时为 0 */
  score: number;
}

/** 单次召回返回的最大条数（spec: 3-5） */
export const RECALL_MAX_RESULTS = 5;
/** 7 天内的新记忆在排序时额外加权 */
export const RECALL_RECENT_BOOST_DAYS = 7;
/** 内容去重：归一化后 Jaccard >= 阈值的视为同一条 */
export const DEDUP_SIMILARITY_THRESHOLD = 0.8;

/** LLM 提取返回的原始结构 */
interface ExtractedMemory {
  type: MemoryType | string;
  content: string;
  importance?: number;
}

/** 把对话数组转成 LLM 可读的「User:/Assistant:」脚本 */
function messagesToScript(messages: UIMessage[]): string {
  return messages
    .map((m) => {
      const text = (m.parts ?? [])
        .filter((p): p is { type: "text"; text: string } => p?.type === "text")
        .map((p) => p.text)
        .join(" ")
        .trim();
      if (!text) return "";
      return `${m.role === "user" ? "User" : "Assistant"}: ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

/** 简单归一化：去首尾空格、压缩内部空白、转小写、去标点 */
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s\p{P}]/gu, "")
    .trim();
}

/** 字符级 Jaccard 相似度（用于去重） */
function jaccardSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const sa = new Set(a.split(""));
  const sb = new Set(b.split(""));
  let inter = 0;
  for (const ch of sa) if (sb.has(ch)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 提取 Prompt —— 按 spec 描述的豆包模型习惯 */
const EXTRACT_PROMPT = `你是一个记忆提取助手。请从以下对话中提取值得记住的信息。

只提取以下类型的信息：
- preference：用户的喜好、偏好（如喜欢的食物、颜色、活动）
- event：用户提到的重要事件（如生日、考试、旅行计划）
- fact：用户的个人信息（如名字、年龄、职业、家庭成员）
- emotion：用户表达的情感状态（如最近压力大、很开心）

如果没有值得记住的信息，返回空数组。

返回 JSON 格式：
[
  { "type": "preference", "content": "用户喜欢草莓味冰淇淋", "importance": 7 },
  { "type": "event", "content": "用户下周有期末考试", "importance": 8 }
]

对话内容：
{messages}`;

/** 解析 LLM 提取结果 —— 严格容错（剥 markdown codefence、空数组） */
export function parseExtractedMemories(raw: string): ExtractedMemory[] {
  if (!raw) return [];
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const arrStart = text.indexOf("[");
  const arrEnd = text.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) {
    text = text.slice(arrStart, arrEnd + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ExtractedMemory[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const t = String(obj.type ?? "").trim();
    const c = String(obj.content ?? "").trim();
    if (!c) continue;
    if (!["preference", "event", "fact", "emotion"].includes(t)) continue;
    let imp = Number(obj.importance ?? 5);
    if (!Number.isFinite(imp)) imp = 5;
    imp = Math.max(1, Math.min(10, Math.round(imp)));
    out.push({ type: t as MemoryType, content: c, importance: imp });
  }
  return out;
}

/**
 * 对一批「待写入记忆」做去重检查：
 *   - 与 DB 中已有同用户、相同 memory_type、相似度 >= 阈值的视为重复，跳过。
 * 返回通过去重检查的记忆条目（含 id / petId / sourceMessage）。
 */
export async function dedupMemories(
  userId: string,
  candidates: ExtractedMemory[],
  petId: string | null,
  sourceMessage: string | null,
): Promise<
  Array<{
    id: string;
    userId: string;
    petId: string | null;
    memoryType: MemoryType;
    content: string;
    importance: number;
    sourceMessage: string | null;
  }>
> {
  if (candidates.length === 0) return [];
  const existing = await db
    .select()
    .from(petMemories)
    .where(eq(petMemories.userId, userId));
  const accepted: Array<{
    id: string;
    userId: string;
    petId: string | null;
    memoryType: MemoryType;
    content: string;
    importance: number;
    sourceMessage: string | null;
  }> = [];
  for (const c of candidates) {
    const norm = normalizeText(c.content);
    const isDup = existing.some(
      (e) =>
        e.memoryType === c.type &&
        jaccardSimilarity(normalizeText(e.content), norm) >=
          DEDUP_SIMILARITY_THRESHOLD,
    );
    if (isDup) continue;
    accepted.push({
      id: randomUUID(),
      userId,
      petId,
      memoryType: c.type as MemoryType,
      content: c.content,
      importance: c.importance ?? 5,
      sourceMessage,
    });
  }
  return accepted;
}

/**
 * 对话完成后异步调用豆包提取记忆 → 去重 → 写入 pet_memories。
 * 设计为不阻塞聊天响应：调用方使用 `void extractMemories(...).catch(...)`。
 * 仅在 VIP 上下文中被调用（由调用方负责校验 hasMemoryAccess）。
 */
export async function extractMemories(
  userId: string,
  messages: UIMessage[],
  opts: { petId?: string | null; sourceMessage?: string | null } = {},
): Promise<number> {
  if (!userId) return 0;
  const script = messagesToScript(messages);
  if (!script) return 0;
  const prompt = EXTRACT_PROMPT.replace("{messages}", script);

  let raw = "";
  try {
    const { text } = await generateText({
      model: getModel(),
      prompt,
      maxOutputTokens: 500,
    });
    raw = text ?? "";
  } catch (err) {
    console.error("[memory] extract LLM call failed:", err);
    return 0;
  }
  const parsed = parseExtractedMemories(raw);
  if (parsed.length === 0) return 0;

  // 取最后一条用户消息作为 sourceMessage，便于溯源
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const sourceMessage =
    opts.sourceMessage ??
    (lastUser
      ? (lastUser.parts ?? [])
          .filter(
            (p): p is { type: "text"; text: string } => p?.type === "text",
          )
          .map((p) => p.text)
          .join(" ")
          .trim()
          .slice(0, 500) || null
      : null);

  const accepted = await dedupMemories(
    userId,
    parsed,
    opts.petId ?? null,
    sourceMessage,
  );
  if (accepted.length === 0) return 0;
  await db.insert(petMemories).values(accepted);
  return accepted.length;
}

/**
 * 从 pet_memories 中检索相关记忆：
 *   1) 取该用户全部非过期记忆
 *   2) 按重要性倒序，7 天内的新记忆额外加权
 *   3) 若有 query 关键词，按关键词命中数打 0-1 相似度；最终按 (score, importance, 7d-boost) 排序
 *   4) 取前 RECALL_MAX_RESULTS (5) 条
 *   5) 命中项 times_recalled + 1 + 更新 last_recalled_at
 */
export async function recallMemory(params: {
  userId: string;
  query?: string;
  /** 可选：限定宠物；为 null 时只召回全局记忆（pet_id IS NULL） */
  petId?: string | null;
  /** 可选：指定类型过滤 */
  types?: MemoryType[];
}): Promise<RecalledMemory[]> {
  const { userId, query = "", petId, types } = params;
  if (!userId) return [];

  const now = new Date();
  const conditions = [
    eq(petMemories.userId, userId),
    or(isNull(petMemories.expiresAt), gt(petMemories.expiresAt, now))!,
  ];
  if (petId === null) {
    conditions.push(isNull(petMemories.petId));
  } else if (typeof petId === "string") {
    // 同时召回该宠物 + 跨宠物（NULL petId）
    conditions.push(or(eq(petMemories.petId, petId), isNull(petMemories.petId))!);
  }

  let rows = (await db
    .select()
    .from(petMemories)
    .where(and(...conditions))) as PetMemoryRow[];

  if (types && types.length > 0) {
    rows = rows.filter((r) => types.includes(r.memoryType as MemoryType));
  }
  if (rows.length === 0) return [];

  // 关键词命中 + 排序
  const qNorm = normalizeText(query);
  const qChars = new Set(qNorm);
  const sevenDayMs = RECALL_RECENT_BOOST_DAYS * 24 * 60 * 60 * 1000;

  const scored: RecalledMemory[] = rows.map((r) => {
    const text = normalizeText(r.content);
    let hits = 0;
    for (const ch of qChars) if (text.includes(ch)) hits++;
    const score = qChars.size === 0 ? 0 : hits / qChars.size;
    return { row: r, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.row.importance !== a.row.importance)
      return b.row.importance - a.row.importance;
    const aRecent = a.row.createdAt.getTime() >= now.getTime() - sevenDayMs;
    const bRecent = b.row.createdAt.getTime() >= now.getTime() - sevenDayMs;
    if (aRecent !== bRecent) return aRecent ? -1 : 1;
    return b.row.createdAt.getTime() - a.row.createdAt.getTime();
  });

  const top = scored.slice(0, RECALL_MAX_RESULTS);

  // 副作用：times_recalled + 1（每行独立更新，避免复杂 SQL）
  for (const id of top.map((t) => t.row.id)) {
    try {
      await db
        .update(petMemories)
        .set({
          timesRecalled: sql`${petMemories.timesRecalled} + 1`,
          lastRecalledAt: now,
        })
        .where(eq(petMemories.id, id));
    } catch (err) {
      console.error("[memory] recall counter update failed:", err);
    }
  }

  return top;
}

/** 把召回结果渲染为注入 System Prompt 的中文段落（spec 给定的格式） */
export function renderMemoryContext(rows: RecalledMemory[]): string {
  if (rows.length === 0) return "";
  const typeLabel: Record<MemoryType, string> = {
    preference: "偏好",
    event: "事件",
    fact: "事实",
    emotion: "情绪",
  };
  const lines = rows
    .map(
      (r) =>
        `- ${r.row.content}（${typeLabel[r.row.memoryType as MemoryType] ?? r.row.memoryType}）`,
    )
    .join("\n");
  return "[你记得关于用户的以下事情，可以在对话中自然提及：]\n" + lines;
}
