import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce, pool } from "@/db/client";
import { chatQuotas } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import {
  getQuotaStatus,
  getRemaining,
  QUOTA_CONFIG,
  todayString,
  type QuotaStatus,
} from "@/lib/chat-quota-config";
import { getActiveSubscription } from "@/lib/subscription-config";

export const runtime = "nodejs";

/**
 * GET /api/chat/quota
 * 返回：{ messageCount, dailyLimit, status, remaining, isVip, expiresAt? }
 *  - 不要求登录；未登录视为 isVip=false
 *  - messageCount：今日已发消息数（仅 free 计数，VIP 不计）
 *  - status: normal / soft_warn / hard_limit / vip
 *  - remaining: free 剩余条数；VIP = -1
 *  - 若有 active 订阅，附 expiresAt（ISO string）
 */
export async function GET(req: Request) {
  await ensureDbSchemaOnce();

  const user = await getUserFromRequest(req);
  const userId = user?.id ?? null;

  if (!userId) {
    // 未登录：直接返回默认（free）
    return NextResponse.json({
      ok: true,
      messageCount: 0,
      dailyLimit: QUOTA_CONFIG.FREE_DAILY_LIMIT,
      status: "normal" as QuotaStatus,
      remaining: QUOTA_CONFIG.FREE_DAILY_LIMIT,
      isVip: false,
    });
  }

  // 1) VIP 检查
  const sub = await getActiveSubscription(userId);
  const isVip = sub !== null;

  // 2) 今日计数（free 才有意义；VIP 直接返回 vip 状态）
  const date = todayString();
  let messageCount = 0;
  if (!isVip) {
    const [row] = await db
      .select({ messageCount: chatQuotas.messageCount })
      .from(chatQuotas)
      .where(and(eq(chatQuotas.userId, userId), eq(chatQuotas.date, date)))
      .limit(1);
    messageCount = row?.messageCount ?? 0;
  }

  const status = getQuotaStatus(messageCount, isVip);
  const remaining = getRemaining(messageCount, isVip);

  return NextResponse.json({
    ok: true,
    messageCount,
    dailyLimit: QUOTA_CONFIG.FREE_DAILY_LIMIT,
    status,
    remaining,
    isVip,
    expiresAt: sub ? sub.expiresAt.toISOString() : null,
    autoRenew: sub?.autoRenew ?? null,
  });
}

/**
 * POST /api/chat/quota  — 内部用：单条消息计数（+1）
 *  - VIP 不计（直接返回 current）
 *  - 同一 date 多次调用累加
 *  - 返回最新计数与状态
 *
 * 实际计数由 /api/chat 调用；这里暴露为 REST endpoint 便于
 * 客户端在 chat 流式响应出错时同步计数（也便于 e2e 测试）。
 */
export async function POST(req: Request) {
  await ensureDbSchemaOnce();
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "signInFirst" }, { status: 401 });
  }

  const sub = await getActiveSubscription(user.id);
  const isVip = sub !== null;

  if (isVip) {
    return NextResponse.json({
      ok: true,
      messageCount: 0,
      status: "vip" as QuotaStatus,
      remaining: -1,
      isVip: true,
    });
  }

  const date = todayString();
  // UPSERT：当日不存在则新建；存在则 message_count + 1
  const id = `quota-${user.id}-${date}`;
  await pool.query(
    `INSERT INTO chat_quotas (id, user_id, date, message_count, last_message_at)
     VALUES ($1, $2, $3, 1, now())
     ON CONFLICT (user_id, date)
     DO UPDATE SET message_count = chat_quotas.message_count + 1,
                   last_message_at = now()`,
    [id, user.id, date],
  );

  const [row] = await db
    .select({ messageCount: chatQuotas.messageCount })
    .from(chatQuotas)
    .where(and(eq(chatQuotas.userId, user.id), eq(chatQuotas.date, date)))
    .limit(1);
  const messageCount = row?.messageCount ?? 0;
  const status = getQuotaStatus(messageCount, false);
  const remaining = getRemaining(messageCount, false);

  return NextResponse.json({
    ok: true,
    messageCount,
    status,
    remaining,
    isVip: false,
  });
}
