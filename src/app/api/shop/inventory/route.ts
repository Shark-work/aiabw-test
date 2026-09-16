import { NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { shopItems, userItems, users } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/shop/inventory
 * 当前用户已购的商城装备列表（source='shop' 的 user_items，JOIN shop_items 取效果元信息）。
 *  返回结构：
 *    {
 *      ok: true,
 *      coins: number,
 *      items: [{
 *        id, itemKey, name, nameZh, nameEn, description, icon,
 *        effectType, effectValue, duration, equippedAdoptionId, createdAt
 *      }]
 *    }
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "signInFirst") },
        { status: 401 },
      );
    }

    await ensureDbSchemaOnce();

    const [u] = await db
      .select({ coins: users.coins })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    // 关联查询：user_items JOIN shop_items ON itemKey = shop_items.id
    // - LEFT JOIN 以防商品被下架（is_active=false）但用户已购的道具仍可见
    const rows = await db
      .select({
        id: userItems.id,
        itemKey: userItems.itemKey,
        rarity: userItems.rarity,
        source: userItems.source,
        equippedAdoptionId: userItems.equippedAdoptionId,
        createdAt: userItems.createdAt,
        // shop_items 字段（LEFT JOIN 拿不到时为 null）
        nameZh: shopItems.nameZh,
        nameEn: shopItems.nameEn,
        descriptionZh: shopItems.descriptionZh,
        descriptionEn: shopItems.descriptionEn,
        icon: shopItems.icon,
        effectType: shopItems.effectType,
        effectValue: shopItems.effectValue,
        duration: shopItems.duration,
        isActive: shopItems.isActive,
      })
      .from(userItems)
      .leftJoin(shopItems, eq(userItems.itemKey, shopItems.id))
      .where(and(eq(userItems.userId, user.id), eq(userItems.source, "shop")))
      .orderBy(desc(userItems.createdAt));

    return NextResponse.json({
      ok: true,
      coins: u?.coins ?? 0,
      items: rows.map((r) => ({
        id: r.id,
        itemKey: r.itemKey,
        name:
          r.nameZh && r.nameEn
            ? locale === "en"
              ? r.nameEn
              : r.nameZh
            : r.itemKey, // 商品已下架/删除 → 兜底显示 itemKey
        nameZh: r.nameZh ?? r.itemKey,
        nameEn: r.nameEn ?? r.itemKey,
        description: r.descriptionZh
          ? locale === "en"
            ? r.descriptionEn ?? ""
            : r.descriptionZh
          : "",
        icon: r.icon ?? "🎁",
        effectType: r.effectType ?? "unknown",
        effectValue: r.effectValue ?? 1.0,
        duration: r.duration ?? -1,
        rarity: r.rarity,
        equippedAdoptionId: r.equippedAdoptionId,
        createdAt: r.createdAt,
        // 标记商品是否已下架（前端可显示"已下架"但仍保留在背包）
        retired: r.isActive === false,
      })),
    });
  } catch (err) {
    console.error("[/api/shop/inventory] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "shopLoadFailed") },
      { status: 500 },
    );
  }
}
