import { NextResponse } from "next/server";

import { db, pool, ensureDbSchemaOnce } from "@/db/client";
import { ugcCreations } from "@/db/schema";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import { getActiveSubscription } from "@/lib/subscription-config";
import {
  FREE_DAILY_PORTRAIT_LIMIT,
  PORTRAIT_COST_YUAN,
  buildPortraitPrompt,
  extractPortraitImageUrl,
  isPortraitStyle,
  isValidPhotoInput,
} from "@/lib/ugc-workshop";

export const runtime = "nodejs";

/**
 * AI 宠物写真工坊 · /api/ugc/generate-portrait
 *
 * GET  → 配额查询：{ isVip, todayCount, dailyLimit, remaining, costYuan }
 * POST → 生成写真：{ petId?, styleType, photo }
 *   - photo：data:image/(png|jpeg|webp);base64,... 或 http(s) 图片 URL
 *   - 免费用户每日限 1 张（低清水印版）；VIP 无限次 + 高清无水印（hd 透传生成端）
 *   - 结果落 ugc_creations（type='portrait', is_premium=isVip）
 *
 * 外部生图服务（阿里云函数计算 ComfyUI / Skill API，按量付费）：
 *   UGC_PORTRAIT_API_URL  生成端点（POST JSON）
 *   UGC_PORTRAIT_API_KEY  鉴权 Bearer（可选）
 */

/** 统计用户今日写真生成次数（免费限额判定） */
async function countTodayPortraits(userId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM ugc_creations
      WHERE user_id = $1
        AND type = 'portrait'
        AND created_at::date = CURRENT_DATE`,
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** GET /api/ugc/generate-portrait —— 配额查询（须登录） */
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(resolveLocale(req), "notSignedIn") },
      { status: 401 },
    );
  }
  await ensureDbSchemaOnce();
  const sub = await getActiveSubscription(user.id);
  const isVip = sub !== null;
  const todayCount = await countTodayPortraits(user.id);
  return NextResponse.json({
    ok: true,
    isVip,
    todayCount,
    // dailyLimit=-1 表示无限（VIP）
    dailyLimit: isVip ? -1 : FREE_DAILY_PORTRAIT_LIMIT,
    remaining: isVip ? -1 : Math.max(0, FREE_DAILY_PORTRAIT_LIMIT - todayCount),
    costYuan: PORTRAIT_COST_YUAN,
  });
}


/** POST /api/ugc/generate-portrait —— 生成写真（须登录；免费日限 1 张 / VIP 无限高清） */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "notSignedIn") },
      { status: 401 },
    );
  }

  let body: { petId?: unknown; petName?: unknown; styleType?: unknown; photo?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "invalidRequest") },
      { status: 400 },
    );
  }

  // 1) 入参校验：风格必须在 10 种预设内；照片必须合法（防注入/防滥用）
  const styleType = typeof body.styleType === "string" ? body.styleType.trim() : "";
  if (!isPortraitStyle(styleType)) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "invalidStyle") },
      { status: 400 },
    );
  }
  if (!isValidPhotoInput(body.photo)) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "invalidPhoto") },
      { status: 400 },
    );
  }
  const photo = body.photo;
  const petId =
    typeof body.petId === "string" && body.petId.trim() ? body.petId.trim().slice(0, 64) : null;
  const petName =
    typeof body.petName === "string" && body.petName.trim()
      ? body.petName.trim().slice(0, 32)
      : undefined;

  await ensureDbSchemaOnce();

  // 2) VIP 分流：VIP → 高清无水印 + 不限次；免费 → 每日 1 张低清水印版
  const sub = await getActiveSubscription(user.id);
  const isVip = sub !== null;
  if (!isVip) {
    const todayCount = await countTodayPortraits(user.id);
    if (todayCount >= FREE_DAILY_PORTRAIT_LIMIT) {
      // P0 先查后写存在并发窗口（同日两次请求可能都通过），影响最多多送 1 张，可接受
      return NextResponse.json(
        {
          ok: false,
          error: apiError(locale, "dailyPortraitLimit"),
          code: "DAILY_LIMIT",
          isVip: false,
          remaining: 0,
        },
        { status: 429 },
      );
    }
  }

  // 3) 外部生图服务配置检查
  const apiUrl = process.env.UGC_PORTRAIT_API_URL ?? "";
  if (!apiUrl) {
    console.error("[ugc/generate-portrait] UGC_PORTRAIT_API_URL not configured");
    return NextResponse.json(
      { ok: false, error: apiError(locale, "portraitNotConfigured") },
      { status: 503 },
    );
  }

  // 4) 调用生图服务（阿里云 FC ComfyUI / Skill API；60s 超时防悬挂）
  const prompt = buildPortraitPrompt(styleType, petName);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.UGC_PORTRAIT_API_KEY ?? "";
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let data: unknown;
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt,
        style: styleType,
        image: photo,
        // hd=false 时由生成端输出低清并叠加水印；VIP 才给高清无水印
        hd: isVip,
        watermark: !isVip,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    data = await res.json().catch(() => null);
    if (!res.ok) {
      console.error("[ugc/generate-portrait] upstream HTTP", res.status, JSON.stringify(data));
      return NextResponse.json(
        { ok: false, error: apiError(locale, "ugcGenerateFailed") },
        { status: 502 },
      );
    }
  } catch (err) {
    console.error("[ugc/generate-portrait] upstream fetch failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "ugcGenerateFailed") },
      { status: 502 },
    );
  }

  const imageUrl = extractPortraitImageUrl(data);
  if (!imageUrl) {
    console.error("[ugc/generate-portrait] no image url in response:", JSON.stringify(data));
    return NextResponse.json(
      { ok: false, error: apiError(locale, "ugcGenerateFailed") },
      { status: 502 },
    );
  }

  // 5) 落库 ugc_creations（is_premium = VIP 解锁标记）
  const [created] = await db
    .insert(ugcCreations)
    .values({
      userId: user.id,
      petId,
      type: "portrait",
      style: styleType,
      imageUrl,
      isPremium: isVip,
    })
    .returning({ id: ugcCreations.id, createdAt: ugcCreations.createdAt });

  const remaining = isVip ? -1 : 0; // 免费用户刚用掉今日唯一 1 次
  return NextResponse.json({
    ok: true,
    id: created.id,
    imageUrl,
    styleType,
    hd: isVip,
    watermarked: !isVip,
    isVip,
    remaining,
    costYuan: PORTRAIT_COST_YUAN,
    createdAt: created.createdAt,
  });
}
