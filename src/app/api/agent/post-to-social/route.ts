import { NextResponse } from "next/server";

import { isSocialPlatform, postToSocial } from "@/lib/agent-social";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/agent/post-to-social
 * 请求体：{ platform: "x" | "xhs", text: string }
 *
 * 安全：
 *   - 必须携带 Authorization: Bearer <CRON_SECRET>（与 Vercel Cron 同密钥）；
 *   - 凭据只从环境变量读取（X_API_KEY / X_API_SECRET / XHS_TOKEN 等），
 *     缺少凭据时优雅返回 500 + 错误说明，绝不崩溃。
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const platform = body?.platform;
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!isSocialPlatform(platform)) {
    return NextResponse.json({ ok: false, error: "platform must be 'x' or 'xhs'" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ ok: false, error: "text is required" }, { status: 400 });
  }

  const result = await postToSocial(platform, text);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, platform, error: result.error },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    platform,
    externalId: result.externalId ?? null,
    dryRun: result.dryRun ?? false,
    note: result.note ?? null,
  });
}
