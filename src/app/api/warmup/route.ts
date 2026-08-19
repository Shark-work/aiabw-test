import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";

export const runtime = "nodejs";

/**
 * GET /api/warmup
 * 部署预热：一次性触发幂等建表/补列/补索引（避免登录/注册等热路径背负 DDL 开销）。
 * 鉴权：Authorization: Bearer <CRON_SECRET>（与 agent 定时任务一致）；
 * 也可在 Vercel 部署完成后手动或定时调用一次。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  try {
    await ensureDbSchemaOnce();
    return NextResponse.json({
      ok: true,
      schemaMs: Date.now() - start,
      message: "schema ensured; DB pool warmed",
    });
  } catch (err) {
    console.error("[warmup] failed:", err);
    return NextResponse.json({ ok: false, error: "warmup failed" }, { status: 500 });
  }
}