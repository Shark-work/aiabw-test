import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { users } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * POST /api/creator/upload
 * 请求头：Authorization: Bearer <token>（需 is_creator）
 * 请求体：图片原始二进制（Content-Type: image/*，≤ 5MB）
 *
 * 头像存储策略：Blob-only 第一方存储。
 *  - 图片上传到 Vercel Blob（public 只读），返回 Blob URL；
 *  - /api/creator/publish 只接受 Blob URL，拒绝一切外部图床（防防盗链失效 + 违规内容）。
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
      return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "onlyCreator") }, { status: 403 });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { ok: false, error: apiError(resolveLocale(req), "uploadNotConfigured") },
        { status: 503 },
      );
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ ok: false, error: "content-type must be image/*" }, { status: 400 });
    }
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > 5 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "avatar must be ≤ 5MB" }, { status: 400 });
    }

    const ext = (contentType.split("/")[1] ?? "png").split(";")[0].replace(/[^a-z0-9]/gi, "") || "png";
    const pathname = `ugc-pets/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const blob = await put(pathname, req.body as ReadableStream, {
      access: "public",
      contentType,
      addRandomSuffix: true,
    });

    return NextResponse.json({ ok: true, url: blob.url });
  } catch (err) {
    console.error("[creator/upload] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "uploadFailed") }, { status: 500 });
  }
}