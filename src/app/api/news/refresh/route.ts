import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";
import { fetchAndStoreNews } from "@/lib/news-fetch";

export const runtime = "nodejs";

/**
 * GET /api/news/refresh
 * 手动 / 定时任务触发抓取（vercel.json cron 每天华盛顿 12:00 = UTC 17:00 调用）。
 * 安全：若配置了 CRON_SECRET，则要求 Authorization: Bearer <CRON_SECRET>
 *       —— Vercel Cron 会自动在请求中注入该 Bearer 头（非遗漏，定时调用不受影响）；
 *       本地手动触发用 scripts/fetch-news.cjs（自动读 .env.local 的 CRON_SECRET）。
 * 返回：{ ok, inserted, total, fallback }
 */
export async function GET(req: Request) {
  // 与 /api/cron/* 同构的可选校验：未配置 CRON_SECRET 时保持公开（本地开发便利）
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
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
