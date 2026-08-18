import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { ugcPets, users } from "@/db/schema";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/creator/pets
 * 获取 UGC 宠物列表（公开，广场浏览用），含创作者邮箱。
 */
export async function GET(req: Request) {
  await ensureDbSchemaOnce();
  try {
    const rows = await db
      .select({
        id: ugcPets.id,
        name: ugcPets.name,
        imageUrl: ugcPets.imageUrl,
        systemPrompt: ugcPets.systemPrompt,
        priceOrPoints: ugcPets.priceOrPoints,
        creatorId: ugcPets.creatorId,
        createdAt: ugcPets.createdAt,
        creatorEmail: users.email,
      })
      .from(ugcPets)
      .leftJoin(users, eq(ugcPets.creatorId, users.id))
      .orderBy(desc(ugcPets.createdAt));

    return NextResponse.json({ ok: true, pets: rows });
  } catch (err) {
    console.error("[creator/pets] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "ugcListFailed") }, { status: 500 });
  }
}
