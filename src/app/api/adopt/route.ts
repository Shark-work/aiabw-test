import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { users, adoptions, threads, messages as messagesTable } from "@/db/schema";
import { defaults as petDefaults, getPet } from "@/lib/pet-config";
import { getUserFromRequest } from "@/lib/auth";
import { timer } from "@/lib/perf";
import {
  buildPetLimitBody,
  evaluatePetLimit,
  FREE_PET_LIMIT,
  isPetLimitError,
  PetLimitError,
} from "@/lib/pet-limit";

export const runtime = "nodejs";

/**
 * POST /api/adopt
 *
 * 请求体（可选）：{ petType?: string, petName?: string }
 *  - petType  宠物类型，默认 "fox"（从 PETS 多宠图鉴选择）。
 *  - petName  用户给宠物起的昵称（可选，默认取该宠物配置里的 name）。
 *
 * 归属：若请求携带有效登录 Token（Authorization: Bearer），userId 使用账号 id；
 *       否则视为游客，userId 为 "anonymous"。
 *
 * 在一个数据库事务里完成：
 *   1. 写入 adoptions 领养记录（petType + petName + userId）
 *   2. 为这只宠物创建一条初始对话线程（threads），标题为「{petName} 的家」
 *   3. 写入一条 assistant 欢迎消息（messages），内容为该宠物的专属欢迎语
 * 成功后返回 { ok, adoption, threadId }。
 */
export async function POST(req: Request) {
  const perf = timer("adopt");
  let petType: string = "fox";
  let petName: string | undefined;
  let anonymousId: string | undefined;

  // 归属：已登录用户写 users.id，游客为 anonymous
  const authed = await getUserFromRequest(req);
  const userId = authed ? authed.id : "anonymous";

  try {
    const body = await req.json();
    if (typeof body?.petType === "string" && body.petType.trim()) {
      petType = body.petType.trim();
    }
    if (typeof body?.petName === "string" && body.petName.trim()) {
      petName = body.petName.trim();
    }
    if (typeof body?.anonymousId === "string" && body.anonymousId.trim()) {
      anonymousId = body.anonymousId.trim();
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
    // 首次访问自动建表（幂等）
    await ensureDbSchemaOnce();
    perf("ensureSchema");

    const result = await db.transaction(async (tx) => {
      // 单宠限制（防并发：先锁用户行，再计数，再插入）。
      // 已解锁（付费）用户不受限制；未解锁用户最多 1 只。
      if (authed) {
        await tx.select().from(users).where(eq(users.id, authed.id)).for("update");
      }
      const [countRow] = await tx
        .select({
          petCount: sql<number>`count(*)`,
          unlockedPetCount: sql<number>`count(*) filter (where ${adoptions.isUnlocked})`,
        })
        .from(adoptions)
        .where(
          authed
            ? eq(adoptions.userId, authed.id)
            : and(
                eq(adoptions.userId, "anonymous"),
                eq(adoptions.anonymousId, anonymousId ?? ""),
              ),
        );
      const decision = evaluatePetLimit({
        petCount: Number(countRow?.petCount ?? 0),
        unlockedPetCount: Number(countRow?.unlockedPetCount ?? 0),
        limit: FREE_PET_LIMIT,
      });
      if (!decision.allowed) {
        // 取一只已有宠物作为“解锁”目标，供前端发起支付
        const [existing] = await tx
          .select({ id: adoptions.id })
          .from(adoptions)
          .where(
            authed
              ? eq(adoptions.userId, authed.id)
              : and(
                  eq(adoptions.userId, "anonymous"),
                  eq(adoptions.anonymousId, anonymousId ?? ""),
                ),
          )
          .limit(1);
        throw new PetLimitError(decision, existing?.id ?? null);
      }

      // 先建线程，再建领养记录并关联 threadId
      const [thread] = await tx
        .insert(threads)
        .values({ userId, title: `${effectiveName} 的家`, anonymousId })
        .returning();

      const [adoption] = await tx
        .insert(adoptions)
        .values({
          userId,
          petName: effectiveName,
          petType,
          anonymousId,
          threadId: thread.id,
        })
        .returning();

      await tx.insert(messagesTable).values({
        threadId: thread.id,
        role: "assistant",
        parts: [{ type: "text", text: welcomeMessage }],
      });

      return { adoption, threadId: thread.id };
    });
    perf("transaction");

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (isPetLimitError(err)) {
      return NextResponse.json(buildPetLimitBody(err.decision, err.unlockAdoptionId), {
        status: 402,
      });
    }
    console.error("Failed to create adoption:", err);
    return NextResponse.json(
      { ok: false, error: "领养记录写入失败，请稍后重试" },
      { status: 500 },
    );
  }
}


