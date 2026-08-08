import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { agentTools } from "@/lib/agent-tools";
import { getPet } from "@/lib/pet-config";
import { getModel } from "@/lib/get-model";
import { db } from "@/db/client";
import { adoptions } from "@/db/schema";

export const maxDuration = 60;

/** 免费畅聊条数：达到该条数后需要赞助解锁。 */
const FREE_MESSAGE_LIMIT = 10;

export async function POST(req: Request) {
  const { messages, petType, adoptionId } = await req.json();

  // 根据 petType 动态切换宠物人设（系统提示词），未提供时回退到狐狸。
  const pet = getPet(petType);

  // 商业化变现：10 句免费门槛。达到后且未解锁时才拒绝调用 AI 模型。
  if (typeof adoptionId === "string" && adoptionId) {
    const [adoption] = await db
      .select({
        chatCount: adoptions.chatCount,
        isUnlocked: adoptions.isUnlocked,
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
          message: `${pet.name}的体力耗尽啦！请赞助一杯奶茶解锁无限畅聊~`,
        },
        // 非 2xx 状态让前端 useChat 通过 error.message 捕获这段 JSON。
        { status: 402 },
      );
    }
  }

  const result = streamText({
    model: getModel(),
    system: pet.systemPrompt,
    messages: convertToModelMessages(messages),
    tools: agentTools,
    // Agent loop: model may call tools, observe results, and respond
    // across up to 5 steps in a single turn.
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
