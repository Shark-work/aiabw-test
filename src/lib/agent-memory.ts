/**
 * 数字人 Agent 记忆库 - DB 层
 *
 * 写入优化（防存储膨胀）：
 *   写入新记忆前，与现有记忆计算余弦相似度，>= 90% 判定为语义重复，
 *   “合并/更新”到最相似的那条（刷新内容 + last_accessed，保留 created_at），不新增行。
 *
 * 生命周期管理（防无限膨胀）：
 *   cleanupStaleMemories() 自动清理 last_accessed 超过 MEMORY_RETENTION_DAYS(30) 天的
 *   低频记忆，每次日更闭环（daily-digest）都会执行。
 */
import { and, desc, eq, lt } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { agentMemories } from "@/db/schema";
import {
  cosineSimilarity,
  DEDUP_SIMILARITY_THRESHOLD,
  embed,
  type MemoryType,
} from "./agent-embedding";

export const MEMORY_RETENTION_DAYS = 30;
/** 去重扫描上限：最多与最近访问的 N 条记忆比较 */
const DEDUP_SCAN_LIMIT = 500;

export type MemoryRow = {
  id: string;
  memoryType: MemoryType;
  content: string;
  createdAt: Date;
  lastAccessed: Date;
  important: boolean;
};

export type WriteMemoryResult = {
  id: string;
  action: "created" | "updated";
  similarity: number;
  important: boolean;
};

export type WriteMemoryOptions = {
  /** 核心记忆标记：重要记忆豁免 30 天低频清理，实现“跨日沉淀”。 */
  important?: boolean;
};

/** 写入记忆（自动语义去重：相似度 >= 90% 合并/更新，不新增）。 */
export async function writeMemory(
  memoryType: MemoryType,
  content: string,
  opts: WriteMemoryOptions = {},
): Promise<WriteMemoryResult> {
  const text = content.trim();
  if (!text) throw new Error("memory content must not be empty");
  const important = !!opts.important;

  await ensureDbSchemaOnce();
  const vec = embed(text);

  const existing = await db
    .select({
      id: agentMemories.id,
      embedding: agentMemories.embedding,
      important: agentMemories.important,
    })
    .from(agentMemories)
    .orderBy(desc(agentMemories.lastAccessed))
    .limit(DEDUP_SCAN_LIMIT);

  let best: { id: string; sim: number } | null = null;
  let bestImportant = false;
  for (const row of existing) {
    if (!Array.isArray(row.embedding) || row.embedding.length === 0) continue;
    const sim = cosineSimilarity(vec, row.embedding);
    if (!best || sim > best.sim) {
      best = { id: row.id, sim };
      bestImportant = !!row.important;
    }
  }

  if (best && best.sim >= DEDUP_SIMILARITY_THRESHOLD) {
    // 语义去重命中：更新最相似记忆（合并内容 + 刷新 last_accessed）
    // important 采用“或”合并：任一标记重要即保留重要（防重要标记在合并中丢失）
    await db
      .update(agentMemories)
      .set({
        content: text,
        embedding: vec,
        lastAccessed: new Date(),
        important: bestImportant || important,
      })
      .where(eq(agentMemories.id, best.id));
    return {
      id: best.id,
      action: "updated",
      similarity: best.sim,
      important: bestImportant || important,
    };
  }

  const [row] = await db
    .insert(agentMemories)
    .values({ memoryType, content: text, embedding: vec, important })
    .returning({ id: agentMemories.id });
  return { id: row.id, action: "created", similarity: 0, important };
}

/** 访问记忆：刷新 last_accessed，避免被 30 天清理机制误删。 */
export async function accessMemory(id: string): Promise<void> {
  await ensureDbSchemaOnce();
  await db
    .update(agentMemories)
    .set({ lastAccessed: new Date() })
    .where(eq(agentMemories.id, id));
}

/**
 * 设置记忆的“重要”标记（核心记忆跨日沉淀）。
 * 重要记忆豁免 cleanupStaleMemories 的 30 天低频清理。
 */
export async function setMemoryImportant(id: string, important: boolean): Promise<void> {
  await ensureDbSchemaOnce();
  await db
    .update(agentMemories)
    .set({ important, lastAccessed: new Date() })
    .where(eq(agentMemories.id, id));
}

/** 列出最近访问的记忆（重要记忆优先，用于注入 Prompt 上下文）。 */
export async function listMemories(limit = 50): Promise<MemoryRow[]> {
  await ensureDbSchemaOnce();
  const rows = await db
    .select({
      id: agentMemories.id,
      memoryType: agentMemories.memoryType,
      content: agentMemories.content,
      createdAt: agentMemories.createdAt,
      lastAccessed: agentMemories.lastAccessed,
      important: agentMemories.important,
    })
    .from(agentMemories)
    .orderBy(desc(agentMemories.important), desc(agentMemories.lastAccessed))
    .limit(limit);
  return rows as MemoryRow[];
}

/** 把记忆渲染为 Prompt 上下文片段（重要记忆带 [核心] 标记）。 */
export function renderMemories(memories: MemoryRow[]): string {
  if (memories.length === 0) return "(暂无记忆)";
  return memories
    .map((m) => `- [${m.memoryType}]${m.important ? "[核心]" : ""} ${m.content}`)
    .join("\n");
}

/**
 * 生命周期清理：删除 last_accessed 超过 days(默认30) 天未访问的低频记忆。
 * 重要记忆（important=true）豁免清理，实现核心记忆的“跨日沉淀”。
 * 返回删除条数。
 */
export async function cleanupStaleMemories(
  days: number = MEMORY_RETENTION_DAYS,
): Promise<number> {
  await ensureDbSchemaOnce();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const res = await db
    .delete(agentMemories)
    .where(
      and(lt(agentMemories.lastAccessed, cutoff), eq(agentMemories.important, false)),
    );
  const removed = res.rowCount ?? 0;
  if (removed > 0) {
    console.log(
      `[agent-memory] purged ${removed} stale memories (last_accessed < ${cutoff.toISOString()}, retention=${days}d, important exempted)`,
    );
  }
  return removed;
}
