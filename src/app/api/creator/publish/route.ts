import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { users, ugcPets } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * POST /api/creator/publish
 * 请求头：Authorization: Bearer <token>（需 is_creator）
 * 请求体：{ name, imageUrl, systemPrompt, priceOrPoints? }
 * 创作者发布自己的 UGC 艾比。
 */
export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Please sign in first" }, { status: 401 });
    }

    await ensureDbSchemaOnce();

    const [me] = await db
      .select({ isCreator: users.isCreator })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    if (!me?.isCreator) {
      return NextResponse.json(
        { ok: false, error: "Only creators can publish UGC pets" },
        { status: 403 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl.trim() : "";
    const systemPrompt =
      typeof body?.systemPrompt === "string" ? body.systemPrompt.trim() : "";
    const priceOrPoints = Math.max(0, Math.floor(Number(body?.priceOrPoints) || 0));

    if (!name || !imageUrl || !systemPrompt) {
      return NextResponse.json(
        { ok: false, error: "name / imageUrl / systemPrompt must not be empty" },
        { status: 400 },
      );
    }

    const [pet] = await db
      .insert(ugcPets)
      .values({ creatorId: user.id, name, imageUrl, systemPrompt, priceOrPoints })
      .returning({
        id: ugcPets.id,
        name: ugcPets.name,
        imageUrl: ugcPets.imageUrl,
        priceOrPoints: ugcPets.priceOrPoints,
      });

    return NextResponse.json({ ok: true, pet });
  } catch (err) {
    console.error("[creator/publish] failed:", err);
    return NextResponse.json({ ok: false, error: "Publish failed, please try again" }, { status: 500 });
  }
}
