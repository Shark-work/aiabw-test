import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getChainStatus } from "@/server/services/soul-card-service";

export const runtime = "nodejs";

/**
 * GET /api/chain/status（公开读）
 * Controller：链状态公开概览 —— provider（模拟/测试网标识）+ 供应计数
 * （max_supply / total_minted / total_burned / circulating / next_token_id）
 * + 最近 20 条链上动态。稀缺凭证总量的公开可验证入口。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  try {
    await ensureDbSchemaOnce();
    const status = await getChainStatus();
    return NextResponse.json({ ok: true, ...status });
  } catch (err) {
    console.error("[/api/chain/status GET] failed:", err);
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", error: apiError(locale, "soulCardLoadFailed") },
      { status: 500 },
    );
  }
}
