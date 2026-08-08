import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { adoptions, threads, messages as messagesTable } from "@/db/schema";
import { defaults as petDefaults, getPet } from "@/lib/pet-config";

export const runtime = "nodejs";

/**
 * POST /api/adopt
 *
 * 请求体（可选）：{ petType?: string, petName?: string, userId?: string }
 *  - petType  宠物类型，默认 "fox"（从 PETS 多宠图鉴选择）。
 *  - petName  用户给宠物起的昵称（可选，默认取该宠物配置里的 name）。
 *  - userId   默认 "anonymous"。
 *
 * 在一个数据库事务里完成：
 *   1. 写入 adoptions 领养记录（petType + petName）
 *   2. 为这只宠物创建一条初始对话线程（threads），标题为「{petName} 的家」
 *   3. 写入一条 assistant 欢迎消息（messages），内容为该宠物的专属欢迎语
 * 成功后返回 { ok, adoption, threadId }。
 */
export async function POST(req: Request) {
  let petType: string = "fox";
  let petName: string | undefined;
  let userId = "anonymous";

  try {
    const body = await req.json();
    if (typeof body?.petType === "string" && body.petType.trim()) {
      petType = body.petType.trim();
    }
    if (typeof body?.petName === "string" && body.petName.trim()) {
      petName = body.petName.trim();
    }
    if (typeof body?.userId === "string" && body.userId.trim()) {
      userId = body.userId.trim();
    }
  } catch {
    // 请求体无法解析时忽略，使用默认值继续。
  }

  // 根据 petType 解析宠物配置；未知类型回退到狐狸。
  const pet = getPet(petType);
  // 展示用名字：优先用户起的昵称，否则用宠物配置名。
  const effectiveName = petName || pet.name;
  const welcomeMessage =
    typeof pet.welcome === "string" && pet.welcome.trim()
      ? pet.welcome.trim()
      : petDefaults.welcome;

  try {
    const result = await db.transaction(async (tx) => {
      const [adoption] = await tx
        .insert(adoptions)
        .values({ userId, petName: effectiveName, petType })
        .returning();

      const [thread] = await tx
        .insert(threads)
        .values({ userId, title: `${effectiveName} 的家` })
        .returning();

      await tx.insert(messagesTable).values({
        threadId: thread.id,
        role: "assistant",
        parts: [{ type: "text", text: welcomeMessage }],
      });

      return { adoption, threadId: thread.id };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("Failed to create adoption:", err);
    return NextResponse.json(
      { ok: false, error: "领养记录写入失败，请稍后重试" },
      { status: 500 },
    );
  }
}


