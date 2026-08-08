import { NextResponse } from "next/server";
import { and, eq, lt, or, sql } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { handbooks } from "@/db/schema";
import { runHandbookTask } from "@/lib/handbook";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 每轮最多处理的任务数（避免一次拉太长） */
const MAX_BATCH = 5;

/**
 * GET /api/cron/process-handbooks （Vercel Cron 兜底）
 * 扫描 handbooks 中 status='processing'（或卡死超过 10 分钟的 generating）
 * 的任务并调用百炼完成生成，确保手账任务 100% 必达。
 *
 * 安全：若配置了 CRON_SECRET，则要求 Authorization: Bearer <CRON_SECRET>。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  await ensureDbSchemaOnce();

  const stale = sql`now() - interval '10 minutes'`;
  const rows = await db
    .select({ id: handbooks.id })
    .from(handbooks)
    .where(
      or(
        eq(handbooks.status, "processing"),
        and(eq(handbooks.status, "generating"), lt(handbooks.updatedAt, stale)),
      ),
    )
    .limit(MAX_BATCH);

  const results = await Promise.allSettled(rows.map((r) => runHandbookTask(r.id)));
  const processed = results.filter((r) => r.status === "fulfilled").length;

  return NextResponse.json({
    ok: true,
    scanned: rows.length,
    processed,
    pending: rows.length - processed,
  });
}
