import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { users, ugcPets, ugcSales, adoptions, threads, messages as messagesTable, pointsLog } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import {
  buildPetLimitBody,
  evaluatePetLimit,
  FREE_PET_LIMIT,
  isPetLimitError,
  PetLimitError,
} from "@/lib/pet-limit";

export const runtime = "nodejs";

/** 创作者分成比例：100%（免费版平台，收益全部归创作者） */
const CREATOR_COMMISSION_RATE = 1;

/**
 * POST /api/pet/buy
 * 请求头：Authorization: Bearer <token>
 * 请求体：{ petId }
 *
 * 事务内完成：扣买家积分 → 结算创作者分成 → 写入 ugc_sales → 创建领养记录 + 线程。
 */
export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const petId = typeof body?.petId === "string" ? body.petId.trim() : "";
    if (!petId) {
      return NextResponse.json({ ok: false, error: "缺少 petId" }, { status: 400 });
    }

    await ensureDbSchemaOnce();

    const result = await db.transaction(async (tx) => {
      const [pet] = await tx
        .select()
        .from(ugcPets)
        .where(eq(ugcPets.id, petId))
        .limit(1);
      if (!pet) {
        throw new Error("PET_NOT_FOUND");
      }
      if (pet.creatorId === user.id) {
        throw new Error("BUY_OWN_PET");
      }

      const price = pet.priceOrPoints;
      // 原子扣减：points >= price 才允许
      const buyerRes = await tx
        .update(users)
        .set({ points: sql`${users.points} - ${price}` })
        .where(and(eq(users.id, user.id), gte(users.points, price)));
      if (buyerRes.rowCount === 0) {
        throw new Error("INSUFFICIENT_POINTS");
      }

      // 单宠限制：上面的 UPDATE 已锁定用户行，计数后再插入可防并发超领。
      // 已解锁（付费）用户不受限制；未解锁用户最多 1 只。
      const [countRow] = await tx
        .select({
          petCount: sql<number>`count(*)`,
          unlockedPetCount: sql<number>`count(*) filter (where ${adoptions.isUnlocked})`,
        })
        .from(adoptions)
        .where(eq(adoptions.userId, user.id));
      const decision = evaluatePetLimit({
        petCount: Number(countRow?.petCount ?? 0),
        unlockedPetCount: Number(countRow?.unlockedPetCount ?? 0),
        limit: FREE_PET_LIMIT,
      });
      if (!decision.allowed) {
        const [existing] = await tx
          .select({ id: adoptions.id })
          .from(adoptions)
          .where(eq(adoptions.userId, user.id))
          .limit(1);
        throw new PetLimitError(decision, existing?.id ?? null);
      }
      await tx.insert(pointsLog).values({ userId: user.id, amount: -price, reason: "ugc_buy" });

      const amount = Math.round(price * CREATOR_COMMISSION_RATE);
      await tx
        .update(users)
        .set({ creatorBalance: sql`${users.creatorBalance} + ${amount}` })
        .where(eq(users.id, pet.creatorId));

      await tx.insert(ugcSales).values({
        petId: pet.id,
        buyerId: user.id,
        creatorId: pet.creatorId,
        amount,
      });

      // 为买家创建领养记录 + 线程（petType 编码为 ugc:<id>）
      const [thread] = await tx
        .insert(threads)
        .values({ userId: user.id, title: `${pet.name} 的家` })
        .returning();

      const [adoption] = await tx
        .insert(adoptions)
        .values({
          userId: user.id,
          petName: pet.name,
          petType: `ugc:${pet.id}`,
          threadId: thread.id,
        })
        .returning();

      await tx.insert(messagesTable).values({
        threadId: thread.id,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `恭喜！你领养了创作者「${pet.name}」，它已经住进你的艾比世界啦~`,
          },
        ],
      });

      return { adoption, threadId: thread.id, amount };
    });

    return NextResponse.json({
      ok: true,
      pointsDeducted: result.amount,
      adoption: result.adoption,
      threadId: result.threadId,
    });
  } catch (err) {
    if (isPetLimitError(err)) {
      return NextResponse.json(buildPetLimitBody(err.decision, err.unlockAdoptionId), {
        status: 402,
      });
    }
    const msg = err instanceof Error ? err.message : "";
    if (msg === "PET_NOT_FOUND") {
      return NextResponse.json({ ok: false, error: "未找到该 UGC 宠物" }, { status: 404 });
    }
    if (msg === "BUY_OWN_PET") {
      return NextResponse.json({ ok: false, error: "不能购买自己发布的宠物" }, { status: 400 });
    }
    if (msg === "INSUFFICIENT_POINTS") {
      return NextResponse.json({ ok: false, error: "积分不足" }, { status: 400 });
    }
    console.error("[pet/buy] failed:", err);
    return NextResponse.json({ ok: false, error: "购买失败，请稍后重试" }, { status: 500 });
  }
}
