import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { threads, messages } from "@/db/schema";

export const maxDuration = 60;

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

const SYSTEM_PROMPT = `你是一个 AI Agent 导航专家。用户会告诉你他的需求、期望和技术水平。请你根据这些信息，从你的知识库中推荐 2-3 个最适合的 AI Agent 工具，并说明推荐理由。如果用户是小白，推荐要简单易用；如果是开发者，推荐要高效强大。`;

export async function POST(req: Request) {
  try {
    const { coreNeed, expectation, techLevel } = await req.json();

    // Validate required parameters
    if (!coreNeed || !expectation || !techLevel) {
      return NextResponse.json(
        { error: "缺少必要参数：coreNeed, expectation, techLevel" },
        { status: 400 },
      );
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "未配置 DEEPSEEK_API_KEY，请在 .env 文件中设置" },
        { status: 500 },
      );
    }

    const userPrompt = `我的核心诉求是：${coreNeed}。我的期望程度是：${expectation}。我的技术水平是：${techLevel}。请为我推荐合适的 AI Agent 工具。`;

    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("DeepSeek API error:", response.status, errorText);
      return NextResponse.json(
        { error: `DeepSeek API 调用失败: ${response.status}` },
        { status: 502 },
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: "DeepSeek API 返回内容为空" },
        { status: 502 },
      );
    }

    // Persist the diagnosis to the database
    let threadId: string | undefined;
    try {
      const [thread] = await db
        .insert(threads)
        .values({
          userId: "anonymous",
          title: `AI 诊断：${coreNeed}`,
        })
        .returning({ id: threads.id });

      if (thread) {
        threadId = thread.id;
        // Store the user's diagnosis input
        await db.insert(messages).values({
          threadId: thread.id,
          role: "user",
          parts: [
            {
              type: "text",
              text: `核心诉求：${coreNeed}；期望程度：${expectation}；技术基础：${techLevel}`,
            },
          ],
        });

        // Store the AI recommendation result
        await db.insert(messages).values({
          threadId: thread.id,
          role: "assistant",
          parts: [{ type: "text", text: content }],
        });
      }
    } catch (dbError) {
      // Log but don't fail the request if persistence fails
      console.error("Failed to persist diagnosis:", dbError);
    }

    return NextResponse.json({ result: content, threadId });
  } catch (error) {
    console.error("Recommend API error:", error);
    return NextResponse.json(
      { error: "服务器内部错误" },
      { status: 500 },
    );
  }
}