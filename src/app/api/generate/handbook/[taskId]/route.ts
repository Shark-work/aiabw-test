import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { handbooks } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/generate/handbook/[taskId]
 * 轮询手账生成结果。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Please sign in first" }, { status: 401 });
  }

  const [task] = await db
    .select()
    .from(handbooks)
    .where(and(eq(handbooks.id, taskId), eq(handbooks.userId, user.id)))
    .limit(1);
  if (!task) {
    return NextResponse.json({ ok: false, error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    taskId: task.id,
    status: task.status,
    title: task.title,
    content: task.content,
    createdAt: task.createdAt,
  });
}
