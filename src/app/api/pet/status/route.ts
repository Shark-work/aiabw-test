import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { adoptions } from "@/db/schema";

export const runtime = "nodejs";

/**
 * GET /api/pet/status?id=<adoptionId>
 * 返回该艾比当前的心情值 happy 与最后互动时间。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ ok: false, error: "Adoption record id is required" }, { status: 400 });
  }

  try {
    // 首次访问自动建表（幂等）
    await ensureDbSchemaOnce();

    const [row] = await db
      .select({
        happiness: adoptions.happiness,
        lastInteractedAt: adoptions.lastInteractedAt,
        level: adoptions.level,
        chatCount: adoptions.chatCount,
        monthlyPoints: adoptions.monthlyPoints,
        isUnlocked: adoptions.isUnlocked,
      })
      .from(adoptions)
      .where(eq(adoptions.id, id))
      .limit(1);

    if (!row) {
      return NextResponse.json({ ok: false, error: "Adoption record not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      happiness: row.happiness,
      lastInteractedAt: row.lastInteractedAt,
      level: row.level,
      chatCount: row.chatCount,
      monthlyPoints: row.monthlyPoints,
      isUnlocked: row.isUnlocked,
    });
  } catch (err) {
    console.error("Failed to load pet status:", err);
    return NextResponse.json({ ok: false, error: "Failed to load pet status" }, { status: 500 });
  }
}
