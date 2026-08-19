import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { users, ugcPets } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { isBlobUrl } from "@/lib/blob-url";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * POST /api/creator/publish
 * 请求头：Authorization: Bearer <token>（需 is_creator）
 * 请求体：{ name, imageUrl, systemPrompt, priceOrPoints? }
 * 创作者发布自己的 UGC 艾比。
 *
 * 头像安全策略：imageUrl 必须为 Vercel Blob 第一方链接（经 /api/creator/upload 上传），
 * 拒绝一切外部图床 URL（防盗链失效 + 违规内容风险）。
 */
export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "signInFirst") }, { status: 401 });
    }

    await ensureDbSchemaOnce();

    const [me] = await db
      .select({ isCreator: users.isCreator })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    if (!me?.isCreator) {
      return NextResponse.json(
        { ok: false, error: apiError(resolveLocale(req), "onlyCreator") },
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

    // Blob-only：拒绝外部图床 URL，头像必须由 /api/creator/upload 上传到 Vercel Blob。
    if (!isBlobUrl(imageUrl)) {
      return NextResponse.json(
        { ok: false, error: apiError(resolveLocale(req), "blobOnly") },
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
    return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "publishFailed") }, { status: 500 });
  }
}
