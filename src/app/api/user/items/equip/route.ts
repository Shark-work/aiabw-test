import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { adoptions, userItems } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/** UUID 粗校验（防脏参数打到 uuid 列引发 500） */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 背包列表查询（装备/卸下后原样返回最新列表，省一次往返） */
async function listItems(userId: string) {
  return db
    .select({
      id: userItems.id,
      itemKey: userItems.itemKey,
      rarity: userItems.rarity,
      source: userItems.source,
      equippedAdoptionId: userItems.equippedAdoptionId,
      createdAt: userItems.createdAt,
    })
    .from(userItems)
    .where(eq(userItems.userId, userId))
    .orderBy(desc(userItems.createdAt));
}

/**
 * POST /api/user/items/equip
 * 道具装备 / 卸下（宠物详情页背包操作）：
 *  - { itemId, adoptionId }：装备到该领养宠物（道具与宠物都需归属当前用户）；
 *  - { itemId, adoptionId: null }：卸下收回背包。
 * 同一宠物可同时装备多件道具（帽子+围巾+玩具组合展示），暂不做槽位互斥。
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const itemId = typeof body?.itemId === "string" ? body.itemId.trim() : "";
    if (!itemId || !UUID_RE.test(itemId)) {
      return NextResponse.json({ ok: false, error: apiError(locale, "itemIdRequired") }, { status: 400 });
    }

    await ensureDbSchemaOnce();

    // 道具归属校验（他人道具 → 403）
    const [item] = await db
      .select({ id: userItems.id, userId: userItems.userId })
      .from(userItems)
      .where(eq(userItems.id, itemId))
      .limit(1);
    if (!item) {
      return NextResponse.json({ ok: false, error: apiError(locale, "itemNotFound") }, { status: 404 });
    }
    if (item.userId !== user.id) {
      return NextResponse.json({ ok: false, error: apiError(locale, "itemNotYours") }, { status: 403 });
    }

    // adoptionId：非空 → 校验宠物归属；空 → 卸下
    let adoptionId: string | null = null;
    if (body?.adoptionId) {
      const raw = String(body.adoptionId).trim();
      if (!UUID_RE.test(raw)) {
        return NextResponse.json({ ok: false, error: apiError(locale, "adoptionNotYours") }, { status: 404 });
      }
      const [adoption] = await db
        .select({ id: adoptions.id })
        .from(adoptions)
        .where(and(eq(adoptions.id, raw), eq(adoptions.userId, user.id)))
        .limit(1);
      if (!adoption) {
        return NextResponse.json({ ok: false, error: apiError(locale, "adoptionNotYours") }, { status: 404 });
      }
      adoptionId = adoption.id;
    }

    await db
      .update(userItems)
      .set({ equippedAdoptionId: adoptionId })
      .where(and(eq(userItems.id, itemId), eq(userItems.userId, user.id)));

    return NextResponse.json({ ok: true, items: await listItems(user.id) });
  } catch (err) {
    console.error("[user/items/equip] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(locale, "equipFailed") }, { status: 500 });
  }
}
