import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { adoptions, handbooks } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { runHandbookTask } from "@/lib/handbook";

export const runtime = "nodejs";

/**
 * POST /api/generate/handbook
 * 请求头：Authorization: Bearer <token>
 * 请求体：{ adoptionId }
 *
 * 性能优化：立即返回 { taskId, status: "processing" }，
 * 后台 fire-and-forget 异步调用百炼生成 Markdown 手账并写入 handbooks 表。
 */
export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Please sign in first" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const adoptionId = typeof body?.adoptionId === "string" ? body.adoptionId.trim() : "";
    if (!adoptionId) {
      return NextResponse.json({ ok: false, error: "adoptionId is required" }, { status: 400 });
    }

    await ensureDbSchemaOnce();

    const [adoption] = await db
      .select({ id: adoptions.id, userId: adoptions.userId })
      .from(adoptions)
      .where(eq(adoptions.id, adoptionId))
      .limit(1);
    if (!adoption) {
      return NextResponse.json({ ok: false, error: "Pet not found" }, { status: 404 });
    }
    if (adoption.userId !== user.id) {
      return NextResponse.json({ ok: false, error: "You cannot generate a journal for this pet" }, { status: 403 });
    }

    const [task] = await db
      .insert(handbooks)
      .values({ userId: user.id, adoptionId, status: "processing" })
      .returning({ id: handbooks.id });

    // 后台异步生成（不阻塞本次响应）
    setTimeout(() => {
      void runHandbookTask(task.id).catch(() => {});
    }, 0);

    return NextResponse.json({ ok: true, taskId: task.id, status: "processing" });
  } catch (err) {
    console.error("[generate/handbook] failed:", err);
    return NextResponse.json({ ok: false, error: "Failed to create the journal task" }, { status: 500 });
  }
}
