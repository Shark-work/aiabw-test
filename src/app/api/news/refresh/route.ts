import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";
import { fetchAndStoreNews } from "@/lib/news-fetch";

export const runtime = "nodejs";

/**
 * GET /api/news/refresh
 * 手动 / 定时任务触发抓取（vercel.json cron 每天华盛顿 12:00 = UTC 17:00 调用）。
 * 返回：{ ok, inserted, total, fallback }
 */
export async function GET() {
  try {
    // 确保 is_domestic/locale 等列已同步（Neon 幂等 ALTER）
    await ensureDbSchemaOnce();
    const result = await fetchAndStoreNews();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[news/refresh] failed:", err);
    return NextResponse.json({ ok: false, error: "refresh failed" }, { status: 500 });
  }
}
