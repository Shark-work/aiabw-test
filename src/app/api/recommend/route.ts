import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { threads, messages } from "@/db/schema";

export const maxDuration = 60;

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

const SYSTEM_PROMPT = `You are an AI Agent navigation expert. The user tells you their need, expectation, and technical level. Based on this, recommend 2-3 of the most suitable AI Agent tools from your knowledge and explain why. If the user is a beginner, recommend simple and easy-to-use tools; if a developer, recommend powerful and efficient ones.`;

export async function POST(req: Request) {
  try {
    const { coreNeed, expectation, techLevel } = await req.json();

    // Validate required parameters
    if (!coreNeed || !expectation || !techLevel) {
      return NextResponse.json(
        { error: "Missing required parameters: coreNeed, expectation, techLevel" },
        { status: 400 },
      );
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "DEEPSEEK_API_KEY is not configured - please set it in the .env file" },
        { status: 500 },
      );
    }

    const userPrompt = `My core need is: ${coreNeed}. My expected level is: ${expectation}. My technical level is: ${techLevel}. Please recommend suitable AI Agent tools for me.`;

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
        { error: `DeepSeek API call failed: ${response.status}` },
        { status: 502 },
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: "DeepSeek API returned empty content" },
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
          title: `AI Diagnosis: ${coreNeed}`,
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
              text: `Core need: ${coreNeed}; Expected level: ${expectation}; Technical level: ${techLevel}`,
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
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}