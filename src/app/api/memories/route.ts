import { NextResponse } from "next/server";
import { and, desc, eq, isNull, or, gt } from "drizzle-orm";

import { db } from "@/db/client";
import { petMemories } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { hasMemoryAccess } from "@/lib/memory-gate";
import { getActiveSubscription } from "@/lib/subscription-config";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import zhMessages from "../../../../messages/zh.json";
import enMessages from "../../../../messages/en.json";

/**
 * GET /api/memories?type=&page=&pageSize=
 *  - 仅 VIP 可访问
 *  - 按 type 过滤；page/pageSize 分页（默认 1/20）
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, code: "SIGN_IN_REQUIRED", error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }
  const ok = await hasMemoryAccess(user.id);
  if (!ok) {
    const dict = (locale === "en" ? enMessages : zhMessages) as unknown as {
      memories?: Record<string, string>;
    };
    return NextResponse.json(
      {
        ok: false,
        code: "VIP_REQUIRED",
        error: dict.memories?.vipOnly ?? "VIP required",
      },
      { status: 403 },
    );
  }
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    50,
    Math.max(1, Number(url.searchParams.get("pageSize") ?? "20") || 20),
  );
  const now = new Date();
  const conditions = [
    eq(petMemories.userId, user.id),
    or(isNull(petMemories.expiresAt), gt(petMemories.expiresAt, now)),
  ];
  if (type && ["preference", "event", "fact", "emotion"].includes(type)) {
    conditions.push(
      eq(
        petMemories.memoryType,
        type as "preference" | "event" | "fact" | "emotion",
      ),
    );
  }
  const where = and(...conditions);
  const allRows = await db
    .select()
    .from(petMemories)
    .where(where)
    .orderBy(desc(petMemories.createdAt));
  const total = allRows.length;
  const memories = allRows.slice((page - 1) * pageSize, page * pageSize);
  // 已通过 VIP 门禁，订阅必存在；剩余天数随列表返回（原由 SSR 页计算，现页面转纯壳后改由 API 提供）
  const sub = await getActiveSubscription(user.id);
  const daysRemaining = sub
    ? Math.max(0, Math.ceil((sub.expiresAt.getTime() - Date.now()) / 86400000))
    : 0;
  return NextResponse.json({
    ok: true,
    memories,
    total,
    page,
    pageSize,
    daysRemaining,
  });
}


