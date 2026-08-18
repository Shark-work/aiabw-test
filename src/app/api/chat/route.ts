import { streamText, convertToModelMessages, stepCountIs } from "ai";
import type { UIMessage } from "ai";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { agentTools } from "@/lib/agent-tools";
import { getModel } from "@/lib/get-model";
import { buildMemorySection, updateMemory } from "@/lib/memory";
import { resolvePetConfig } from "@/lib/ugc";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { db, ensureDbSchemaOnce } from "@/db/client";
import { adoptions } from "@/db/schema";

export const maxDuration = 60;

/** 免费畅聊条数：达到该条数后需要赞助解锁。 */
const FREE_MESSAGE_LIMIT = 10;

export async function POST(req: Request) {
  const { messages, petType, adoptionId } = (await req.json()) as {
    messages: UIMessage[];
    petType?: string;
    adoptionId?: string;
  };
  const locale = resolveLocale(req);

  // 根据 petType 动态切换宠物人设（系统提示词），未提供时回退到狐狸。
  // UGC 宠物（petType=ugc:<id>）从数据库读取创作者设置的人设。
  const pet = await resolvePetConfig(petType);

  // 首次访问自动建表（幂等）
  await ensureDbSchemaOnce();

  // 商业化变现：10 句免费门槛。达到后且未解锁时才拒绝调用 AI 模型。
  // 同时读取长期记忆用于注入。
  let memoryContext: string | null = null;
  if (typeof adoptionId === "string" && adoptionId) {
    const [adoption] = await db
      .select({
        chatCount: adoptions.chatCount,
        isUnlocked: adoptions.isUnlocked,
        memoryContext: adoptions.memoryContext,
      })
      .from(adoptions)
      .where(eq(adoptions.id, adoptionId))
      .limit(1);

    if (
      adoption &&
      adoption.chatCount >= FREE_MESSAGE_LIMIT &&
      !adoption.isUnlocked
    ) {
      return NextResponse.json(
        {
          blocked: true,
          message: apiError(locale, "chatBlocked", { name: pet.name }),
        },
        // 非 2xx 状态让前端 useChat 通过 error.message 捕获这段 JSON。
        { status: 402 },
      );
    }

    memoryContext = adoption?.memoryContext ?? null;
  }

  // 长期记忆注入：把 memory_context 追加到 System Prompt
  const memorySection = buildMemorySection(memoryContext);
  const system = memorySection
    ? `${pet.systemPrompt}\n\n${memorySection}`
    : pet.systemPrompt;

  const result = streamText({
    model: getModel(),
    system,
    messages: convertToModelMessages(messages),
    tools: agentTools,
    // Agent loop: model may call tools, observe results, and respond
    // across up to 5 steps in a single turn.
    stopWhen: stepCountIs(5),
    // 对话流结束后：异步提取长期记忆（不阻塞回复）
    onFinish: async (event) => {
      if (typeof adoptionId === "string" && adoptionId) {
        void updateMemory(adoptionId, messages, event.text ?? "").catch((err) =>
          console.error("[memory] update failed:", err),
        );
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
