import { generateText } from "ai";
import { and, asc, eq, lt, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { adoptions, handbooks, messages as messagesTable } from "@/db/schema";
import { getModel } from "@/lib/get-model";
import { resolvePetConfig } from "@/lib/ugc";

const HANDBOOK_PROMPT = `你是「艾比世界」的记忆手账助手。请把用户与宠物之间的聊天记录整理成一份温暖的 Markdown 记忆手账。
要求：
- 用 Markdown 输出，包含：# 标题、## 小节（例如「我们的相遇」「喜欢的点点滴滴」「重要时刻」「写给未来的你」等）。
- 语气温柔，像宠物写给主人的手账。
- 从对话中提炼用户的偏好、宠物相关趣事、重要经历；如果信息不多，就写鼓励与陪伴的话。
- 只输出 Markdown 内容，不要输出解释。`;

/**
 * 异步执行手账生成任务：读取聊天记录 → 调用百炼生成 Markdown → 写回 handbooks。
 * 由 POST /api/generate/handbook（辅助）或 Vercel Cron（兜底）调用。
 *
 * 认领机制：先原子把 status 从 processing（或卡死超过 10 分钟的 generating）
 * 置为 generating，防止 setTimeout 与 Cron 并发重复生成。
 */
export async function runHandbookTask(taskId: string): Promise<void> {
  const claimed = await db
    .update(handbooks)
    .set({ status: "generating", updatedAt: new Date() })
    .where(
      and(
        eq(handbooks.id, taskId),
        or(
          eq(handbooks.status, "processing"),
          and(
            eq(handbooks.status, "generating"),
            lt(handbooks.updatedAt, sql`now() - interval '10 minutes'`),
          ),
        ),
      ),
    );
  if (claimed.rowCount === 0) {
    return; // 已被其它 worker 认领，跳过
  }

  const [task] = await db
    .select()
    .from(handbooks)
    .where(eq(handbooks.id, taskId))
    .limit(1);
  if (!task) return;

  try {
    let messagesText = "（没有找到聊天记录）";
    let petName = "艾比";

    if (task.adoptionId) {
      const [adoption] = await db
        .select({ threadId: adoptions.threadId, petType: adoptions.petType })
        .from(adoptions)
        .where(eq(adoptions.id, task.adoptionId))
        .limit(1);
      if (adoption) {
        const pet = await resolvePetConfig(adoption.petType);
        petName = pet?.name ?? "艾比";
        if (adoption.threadId) {
          const rows = await db
            .select()
            .from(messagesTable)
            .where(eq(messagesTable.threadId, adoption.threadId))
            .orderBy(asc(messagesTable.createdAt));
          const lines = rows
            .map((r) => {
              const parts = r.parts as { type?: string; text?: string }[];
              const textPart = parts.find((p) => p.type === "text");
              const text = typeof textPart?.text === "string" ? textPart.text : "";
              return text ? `${r.role === "user" ? "主人" : "宠物"}：${text}` : "";
            })
            .filter(Boolean);
          messagesText = lines.length ? lines.join("\n") : "（还没有聊天记录）";
        }
      }
    }

    const { text } = await generateText({
      model: getModel(),
      temperature: 0.7,
      maxOutputTokens: 1200,
      system: HANDBOOK_PROMPT,
      prompt: `宠物名字：${petName}\n\n聊天记录：\n${messagesText}`,
    });

    await db
      .update(handbooks)
      .set({
        title: `${petName} 的记忆手账`,
        content: text.trim(),
        status: "done",
        updatedAt: new Date(),
      })
      .where(eq(handbooks.id, taskId));
  } catch (err) {
    console.error("[handbook] task failed:", err);
    await db
      .update(handbooks)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(handbooks.id, taskId));
  }
}
