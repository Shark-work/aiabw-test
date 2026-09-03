import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { userItems } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/user/items
 * 用户道具背包（P0-1 每日签到心情盲盒产出）：
 *  - 返回该用户全部道具（含已装备），按获得时间倒序；
 *  - 道具元信息（名称/emoji）由客户端用 src/lib/checkin-items.ts 目录解析。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }

    await ensureDbSchemaOnce();
    const rows = await db
      .select({
        id: userItems.id,
        itemKey: userItems.itemKey,
        rarity: userItems.rarity,
        source: userItems.source,
        equippedAdoptionId: userItems.equippedAdoptionId,
        createdAt: userItems.createdAt,
      })
      .from(userItems)
      .where(eq(userItems.userId, user.id))
      .orderBy(desc(userItems.createdAt));

    return NextResponse.json({ ok: true, items: rows });
  } catch (err) {
    console.error("[user/items] list failed:", err);
    return NextResponse.json({ ok: false, error: apiError(locale, "itemsLoadFailed") }, { status: 500 });
  }
}
