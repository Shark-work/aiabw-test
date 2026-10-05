import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import { loadActivePromotions, loadMyPromotions } from "@/lib/promotions";
import { redactSensitive } from "@/lib/privacy";

export const runtime = "nodejs";

/**
 * GET /api/content/promoted — 推荐曝光位列表
 *  - 默认（公开）：当前生效中的推荐位（最多 N 坑位），返回即累计一次曝光；
 *  - ?mine=1（鉴权）：我的推广记录（含已过期，不累计曝光）。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const anonName = locale === "en" ? "Anonymous" : "匿名用户";
  try {
    await ensureDbSchemaOnce();
    const url = new URL(req.url);
    if (url.searchParams.get("mine") === "1") {
      const user = await getUserFromRequest(req);
      if (!user) {
        return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
      }
      const items = await loadMyPromotions(user.id, locale, anonName);
      return NextResponse.json({ ok: true, items });
    }
    const items = await loadActivePromotions(locale, anonName, { countView: true });
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    console.error("[content/promoted] failed:", redactSensitive(err instanceof Error ? err.message : String(err)));
    return NextResponse.json({ ok: false, error: "promoted_failed" }, { status: 500 });
  }
}
