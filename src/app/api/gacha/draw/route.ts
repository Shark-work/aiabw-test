import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import {
  users,
  ugcPets,
  adoptions,
  threads,
  messages as messagesTable,
  pointsLog,
} from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { PETS, type PetType } from "@/lib/pet-config";
import {
  buildPetLimitBody,
  evaluatePetLimit,
  FREE_PET_LIMIT,
  isPetLimitError,
  PetLimitError,
} from "@/lib/pet-limit";

export const runtime = "nodejs";

/** 盲盒抽取消耗积分 */
const GACHA_COST = 100;

/** 官方宠物池 */
const OFFICIAL_TYPES: PetType[] = ["fox", "penguin", "dog"];

/**
 * POST /api/gacha/draw
 * 请求头：Authorization: Bearer <token>
 * 扣除 points → 从官方 + UGC 宠物池随机抽取 → 写入 adoptions。纯数据库操作。
 */
export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
    }

    await ensureDbSchemaOnce();

    const result = await db.transaction(async (tx) => {
      // 原子扣积分
      const deduct = await tx
        .update(users)
        .set({ points: sql`${users.points} - ${GACHA_COST}` })
        .where(and(eq(users.id, user.id), gte(users.points, GACHA_COST)));
      if (deduct.rowCount === 0) {
        throw new Error("INSUFFICIENT_POINTS");
      }

      // 单宠限制：上面的 UPDATE 已锁定用户行，读取用户解锁标记 + 计数后再插入可防并发超抽。
      // 全局解锁（users.is_unlocked）用户不受限制；未解锁用户最多 1 只。
      const [me] = await tx
        .select({ isUnlocked: users.isUnlocked })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      const [countRow] = await tx
        .select({
          petCount: sql<number>`count(*)`,
        })
        .from(adoptions)
        .where(eq(adoptions.userId, user.id));
      const decision = evaluatePetLimit({
        petCount: Number(countRow?.petCount ?? 0),
        isUnlocked: !!me?.isUnlocked,
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
      await tx.insert(pointsLog).values({ userId: user.id, amount: -GACHA_COST, reason: "gacha" });

      // 宠物池：官方 + UGC
      const pool: { petType: string; name: string; avatar: string; welcome: string }[] =
        OFFICIAL_TYPES.map((t) => ({
          petType: t,
          name: PETS[t].name,
          avatar: PETS[t].avatar,
          welcome: `🎁 盲盒开到了「${PETS[t].name}」！它已经住进你的艾比世界啦~`,
        }));
      const ugcRows = await tx.select().from(ugcPets);
      for (const u of ugcRows) {
        pool.push({
          petType: `ugc:${u.id}`,
          name: u.name,
          avatar: u.imageUrl,
          welcome: `🎁 盲盒开到了创作者作品「${u.name}」！它已经住进你的艾比世界啦~`,
        });
      }
      if (pool.length === 0) {
        throw new Error("EMPTY_POOL");
      }

      const pick = pool[Math.floor(Math.random() * pool.length)];

      const [thread] = await tx
        .insert(threads)
        .values({ userId: user.id, title: `${pick.name} 的家` })
        .returning();

      const [adoption] = await tx
        .insert(adoptions)
        .values({
          userId: user.id,
          petName: pick.name,
          petType: pick.petType,
          threadId: thread.id,
        })
        .returning();

      await tx.insert(messagesTable).values({
        threadId: thread.id,
        role: "assistant",
        parts: [{ type: "text", text: pick.welcome }],
      });

      return { petType: pick.petType, petName: pick.name, avatar: pick.avatar, adoption, threadId: thread.id };
    });

    return NextResponse.json({
      ok: true,
      cost: GACHA_COST,
      petType: result.petType,
      petName: result.petName,
      avatar: result.avatar,
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
    if (msg === "INSUFFICIENT_POINTS") {
      return NextResponse.json({ ok: false, error: "积分不足" }, { status: 400 });
    }
    if (msg === "EMPTY_POOL") {
      return NextResponse.json({ ok: false, error: "宠物池为空" }, { status: 400 });
    }
    console.error("[gacha/draw] failed:", err);
    return NextResponse.json({ ok: false, error: "抽取失败，请稍后重试" }, { status: 500 });
  }
}
