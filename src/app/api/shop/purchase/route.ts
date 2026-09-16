import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { eq, and, sql } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { shopItems, userItems, userOrders, users, adoptions } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { isPremium } from "@/lib/premium";
import { apiError, resolveLocale } from "@/i18n/api-errors";
// 注：商品元信息（含价格、premium、name/i18n）从 DB 读取，SHOP_ITEMS 仅作客户端/SSG 展示用。
// 此处不 import SHOP_ITEMS：服务端所有校验均查 shop_items 表，避免误用。

export const runtime = "nodejs";

/** 生成 32 字符 hex id（替代 SQLite 的 randomblob 兼容写法） */
function genOrderId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * POST /api/shop/purchase
 * 请求体：{ itemId: string, adoptionId?: string, quantity?: number }
 *  - 校验：登录 / 商品存在且 active / premium 商品需月卡 / 金币 >= 总价
 *  - 事务：扣减金币（原子条件更新） + 写 user_order + 写 user_items（source='shop'）
 *  - 永久装备（duration=-1）→ 自动装备到 user_items.equipped_adoption_id（若提供 adoptionId）
 *  - 消耗品（duration>0，本期未实现）→ 装备但不入 user_pets.equipped_items
 *  - 返回：{ success, remainingCoins, item, orderId }
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "signInFirst") },
        { status: 401 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      itemId?: string;
      adoptionId?: string;
      quantity?: number;
    };
    const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    const quantity = Math.max(1, Math.min(99, Math.floor(body.quantity ?? 1)));
    const adoptionId =
      typeof body.adoptionId === "string" && body.adoptionId.trim()
        ? body.adoptionId.trim()
        : null;

    if (!itemId) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "itemIdRequired") },
        { status: 400 },
      );
    }

    await ensureDbSchemaOnce();

    // 商品存在性 + 激活
    const [item] = await db
      .select()
      .from(shopItems)
      .where(and(eq(shopItems.id, itemId), eq(shopItems.isActive, true)))
      .limit(1);
    if (!item) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "itemNotFound") },
        { status: 404 },
      );
    }

    // premium 商品需月卡
    if (item.isPremium) {
      const [u] = await db
        .select({ premiumUntil: users.premiumUntil })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      if (!isPremium(u?.premiumUntil)) {
        return NextResponse.json(
          { ok: false, error: apiError(locale, "premiumRequired") },
          { status: 403 },
        );
      }
    }

    // 校验 adoptionId 归属（仅校验归属，不强制）
    if (adoptionId) {
      const [adoption] = await db
        .select({ id: adoptions.id, userId: adoptions.userId })
        .from(adoptions)
        .where(eq(adoptions.id, adoptionId))
        .limit(1);
      if (!adoption || adoption.userId !== user.id) {
        return NextResponse.json(
          { ok: false, error: apiError(locale, "adoptionNotYours") },
          { status: 403 },
        );
      }
    }

    const totalPrice = item.price * quantity;

    // 原子事务：扣减金币（防并发双重扣减） + 写订单 + 写背包
    const orderId = genOrderId();
    const result = await db.transaction(async (tx) => {
      // 条件更新：仅当 coins >= totalPrice 时才扣减
      const upd = await tx
        .update(users)
        .set({ coins: sql`${users.coins} - ${totalPrice}` })
        .where(and(eq(users.id, user.id), sql`${users.coins} >= ${totalPrice}`))
        .returning({ coins: users.coins });
      if (upd.length === 0) {
        return { ok: false as const, reason: "insufficient" as const };
      }

      // 写订单
      await tx.insert(userOrders).values({
        id: orderId,
        userId: user.id,
        itemId: item.id,
        quantity,
        totalPrice,
        currency: item.currency,
        status: "completed",
      });

      // 写背包（每件一行，永久装备一次性入库 quantity 条）
      const insertedItemIds: string[] = [];
      for (let i = 0; i < quantity; i++) {
        const inserted = await tx
          .insert(userItems)
          .values({
            userId: user.id,
            itemKey: item.id,
            rarity:
              item.effectType === "rare_event"
                ? "rare"
                : item.isPremium
                  ? "epic"
                  : "common",
            source: "shop",
            equippedAdoptionId: adoptionId, // 永久装备自动装备；消耗品也是相同字段但本期无过期
          })
          .returning({ id: userItems.id });
        insertedItemIds.push(inserted[0]?.id ?? "");
      }

      return {
        ok: true as const,
        remainingCoins: upd[0].coins,
        insertedItemIds,
      };
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "insufficientCoins") },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      success: true,
      orderId,
      remainingCoins: result.remainingCoins,
      item: {
        id: item.id,
        name: locale === "en" ? item.nameEn : item.nameZh,
        icon: item.icon,
        effectType: item.effectType,
        duration: item.duration,
      },
      insertedItemIds: result.insertedItemIds,
    });
  } catch (err) {
    console.error("[/api/shop/purchase] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "purchaseFailed") },
      { status: 500 },
    );
  }
}
