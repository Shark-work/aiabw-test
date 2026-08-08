import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";

export const runtime = "nodejs";

/**
 * GET/POST /api/init
 * 手动触发一次幂等自动建表（生产空库首次访问时可先调用本接口，或在任意
 * DB 路由首次请求时自动触发）。返回表结构是否就绪。
 */
export async function GET() {
  await ensureDbSchemaOnce();
  return NextResponse.json({ ok: true, message: "database schema is ready" });
}

export async function POST() {
  await ensureDbSchemaOnce();
  return NextResponse.json({ ok: true, message: "database schema is ready" });
}
