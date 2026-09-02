import { NextResponse } from "next/server";

import { getVapidKeys, isPushConfigured } from "@/lib/web-push";

export const runtime = "nodejs";

/**
 * GET /api/push/config — 前端订阅前的配置探测（无需登录）。
 * 返回 { ok, enabled, publicKey }；enabled=false 表示未配置 VAPID，前端隐藏推送入口。
 */
export async function GET() {
  const enabled = isPushConfigured();
  return NextResponse.json({
    ok: true,
    enabled,
    publicKey: enabled ? getVapidKeys()?.publicKey : null,
  });
}