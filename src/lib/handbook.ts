import { generateText } from "ai";
import { and, asc, eq, lt, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { adoptions, handbooks, messages as messagesTable } from "@/db/schema";
import { getModel } from "@/lib/get-model";
import { resolvePetConfig } from "@/lib/ugc";

const HANDBOOK_PROMPT = `You are the memory journal assistant of "AIABW". Turn the chat history between the user and their pet into a warm Markdown memory journal.
Requirements:
- Output in Markdown, including: # title, ## sections (e.g. "How we met", "Little things I love", "Important moments", "A letter to your future self", etc.).
- Gentle tone, like a journal written by the pet to its owner.
- Extract the user's preferences, pet-related fun facts and important experiences from the conversation; if there is little information, write words of encouragement and companionship.
- Output the Markdown content only - no explanations.`;

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
    let messagesText = "(No chat history found)";
    let petName = "Aibi";

    if (task.adoptionId) {
      const [adoption] = await db
        .select({ threadId: adoptions.threadId, petType: adoptions.petType })
        .from(adoptions)
        .where(eq(adoptions.id, task.adoptionId))
        .limit(1);
      if (adoption) {
        const pet = await resolvePetConfig(adoption.petType);
        petName = pet?.name ?? "Aibi";
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
              return text ? `${r.role === "user" ? "Owner" : "Pet"}: ${text}` : "";
            })
            .filter(Boolean);
          messagesText = lines.length ? lines.join("\n") : "(No chat history yet)";
        }
      }
    }

    const { text } = await generateText({
      model: getModel(),
      temperature: 0.7,
      maxOutputTokens: 1200,
      system: HANDBOOK_PROMPT,
      prompt: `Pet name: ${petName}\n\nChat history:\n${messagesText}`,
    });

    await db
      .update(handbooks)
      .set({
        title: `${petName}'s Memory Journal`,
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
