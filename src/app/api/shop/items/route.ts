import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { shopItems, userItems, users } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { isPremium } from "@/lib/premium";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/shop/items
 * 返回所有 is_active=TRUE 的商城商品 + 当前用户金币余额 + 已购状态。
 *  - 未登录：只返回商品列表（不返回 owned/coins，避免越权）
 *  - 登录用户：
 *     - coins: 当前金币余额（来源 users.coins）
 *     - premium: 是否高级公民月卡用户（premiumUntil > now）
 *     - owned: 该用户已购（source='shop' 的 user_items 记录中存在 itemKey）
 *     - locked: 高级公民限定商品，普通用户购买时 locked=true
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  try {
    await ensureDbSchemaOnce();

    // 商品目录：按 sort_order, id 排序
    const items = await db
      .select()
      .from(shopItems)
      .where(eq(shopItems.isActive, true))
      .orderBy(shopItems.sortOrder, shopItems.id);

    const user = await getUserFromRequest(req);
    if (!user) {
      // 未登录：只返回商品目录
      return NextResponse.json({
        ok: true,
        coins: 0,
        premium: false,
        items: items.map((it) => ({
          id: it.id,
          name: locale === "en" ? it.nameEn : it.nameZh,
          nameZh: it.nameZh,
          nameEn: it.nameEn,
          description: locale === "en" ? it.descriptionEn : it.descriptionZh,
          descriptionZh: it.descriptionZh,
          descriptionEn: it.descriptionEn,
          icon: it.icon,
          price: it.price,
          currency: it.currency,
          effectType: it.effectType,
          effectValue: it.effectValue,
          duration: it.duration,
          isPremium: it.isPremium,
          sortOrder: it.sortOrder,
          owned: false,
          locked: it.isPremium, // 视为锁定（未登录且是 premium 商品）
        })),
      });
    }

    // 登录用户：拉 coins + premium + owned
    const [u] = await db
      .select({ coins: users.coins, premiumUntil: users.premiumUntil })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const premium = isPremium(u?.premiumUntil);
    const coins = u?.coins ?? 0;

    const owned = await db
      .select({ itemKey: userItems.itemKey })
      .from(userItems)
      .where(and(eq(userItems.userId, user.id), eq(userItems.source, "shop")));
    const ownedSet = new Set(owned.map((o) => o.itemKey));

    return NextResponse.json({
      ok: true,
      coins,
      premium,
      items: items.map((it) => ({
        id: it.id,
        name: locale === "en" ? it.nameEn : it.nameZh,
        nameZh: it.nameZh,
        nameEn: it.nameEn,
        description: locale === "en" ? it.descriptionEn : it.descriptionZh,
        descriptionZh: it.descriptionZh,
        descriptionEn: it.descriptionEn,
        icon: it.icon,
        price: it.price,
        currency: it.currency,
        effectType: it.effectType,
        effectValue: it.effectValue,
        duration: it.duration,
        isPremium: it.isPremium,
        sortOrder: it.sortOrder,
        owned: ownedSet.has(it.id),
        locked: it.isPremium && !premium, // premium 商品 + 非月卡 → 锁定
      })),
    });
  } catch (err) {
    console.error("[/api/shop/items] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "shopLoadFailed") },
      { status: 500 },
    );
  }
}
