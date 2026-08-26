import { streamText, convertToModelMessages, stepCountIs } from "ai";
import type { UIMessage } from "ai";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { agentTools } from "@/lib/agent-tools";
import { getModel } from "@/lib/get-model";
import { buildMemorySection, updateMemory } from "@/lib/memory";
import { compressConversation } from "@/lib/context-compress";
import { resolvePetConfig } from "@/lib/ugc";
import { getUserFromRequest } from "@/lib/auth";
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

  // —— 商业闭环强校验：只有「已登录 + 拥有该宠物」的用户才能调用 AI 对话 ——
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "signInFirst"), code: "SIGN_IN_REQUIRED" },
      { status: 401 },
    );
  }
  if (typeof adoptionId !== "string" || !adoptionId) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "noPermissionPet"), code: "OWNERSHIP_REQUIRED" },
      { status: 403 },
    );
  }

  // 根据 petType 动态切换宠物人设（系统提示词），未提供时回退到狐狸。
  // UGC 宠物（petType=ugc:<id>）从数据库读取创作者设置的人设；
  // 图鉴物种（petType=species:<id>）用字典物种知识动态构建人设。
  const pet = await resolvePetConfig(petType, locale);

  // 首次访问自动建表（幂等）
  await ensureDbSchemaOnce();

  // 商业化变现：10 句免费门槛。达到后且未解锁时才拒绝调用 AI 模型。
  // 同时读取长期记忆用于注入。
  let memoryContext: string | null = null;
  {
    const [adoption] = await db
      .select({
        userId: adoptions.userId,
        chatCount: adoptions.chatCount,
        isUnlocked: adoptions.isUnlocked,
        memoryContext: adoptions.memoryContext,
      })
      .from(adoptions)
      .where(eq(adoptions.id, adoptionId))
      .limit(1);

    // 宠物必须存在且属于当前登录用户（所有权绑定）
    if (!adoption) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "adoptionNotFound"), code: "OWNERSHIP_REQUIRED" },
        { status: 404 },
      );
    }
    if (adoption.userId !== user.id) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "noPermissionPet"), code: "OWNERSHIP_REQUIRED" },
        { status: 403 },
      );
    }

    if (adoption.chatCount >= FREE_MESSAGE_LIMIT && !adoption.isUnlocked) {
      return NextResponse.json(
        {
          blocked: true,
          message: apiError(locale, "chatBlocked", { name: pet.name }),
        },
        // 非 2xx 状态让前端 useChat 通过 error.message 捕获这段 JSON。
        { status: 402 },
      );
    }

    memoryContext = adoption.memoryContext ?? null;
  }

  // —— Token 优化：上下文压缩 ——
  // 对话超过阈值（默认 12 轮）时，把早期轮次归档为一条规则化语义摘要（零 Token），
  // 仅保留最近若干轮原始对话，避免完整历史原封不动发给模型。
  const { messages: recentMessages, summary } = compressConversation(messages);

  // 长期记忆注入 + 早期对话摘要 → 拼入 System Prompt（会话内仅发送一次，不随每轮重复）
  const memorySection = buildMemorySection(memoryContext);
  const system = [
    pet.systemPrompt,
    memorySection || null,
    summary ? `\n\n# 早期对话摘要（已归档）\n${summary}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = streamText({
    model: getModel(),
    system,
    messages: convertToModelMessages(recentMessages),
    tools: agentTools,
    // Agent loop: model may call tools, observe results, and respond
    // across up to 5 steps in a single turn.
    stopWhen: stepCountIs(5),
    // 对话流结束后：异步提取长期记忆（不阻塞回复）。
    // 记忆提取基于完整原始对话（messages），保证记忆质量不受上下文压缩影响。
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
