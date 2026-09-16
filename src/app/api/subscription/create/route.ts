import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { subscriptionPlans } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getActiveSubscription } from "@/lib/subscription-config";
import {
  XORPAY_AID,
  XORPAY_APP_SECRET,
  buildXorpaySign,
  createXorpayOrder,
  getXorpayPayType,
  resolveNotifyUrl,
} from "@/lib/xorpay";
import crypto from "crypto";

export const runtime = "nodejs";

/**
 * POST /api/subscription/create
 * 请求体：{ planId: 'monthly' | 'quarterly' | 'yearly' }
 *
 * 流程：
 *  1. 校验登录、计划存在且 is_active
 *  2. 复用 xorpay 通道：order_id = subscription-<planId>-<userId>-<nonce>
 *  3. 价格与天数完全由 DB 决定（前端不可注入）
 *  4. 如果用户已有 active 订阅，返回 renewingNote 提示，订阅仍可创建
 *     （下次到期日由 xorpay 回调中按 "未到期顺延" 规则处理）
 */
export async function POST(req: Request) {
  await ensureDbSchemaOnce();
  const locale = resolveLocale(req);

  let body: { planId?: string } = {};
  try {
    body = (await req.json()) as { planId?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "invalidRequest") },
      { status: 400 },
    );
  }

  const planId = typeof body.planId === "string" ? body.planId.trim() : "";
  if (!planId) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "planNotFound") },
      { status: 400 },
    );
  }

  // 鉴权
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }

  // 校验支付环境变量
  const missing: string[] = [];
  if (!XORPAY_AID) missing.push("XORPAY_AID");
  if (!XORPAY_APP_SECRET) missing.push("XORPAY_SECRET");
  if (!resolveNotifyUrl()) missing.push("XORPAY_NOTIFY_URL");
  if (missing.length > 0) {
    console.error("[subscription/create] missing payment config:", missing.join(", "));
    return NextResponse.json(
      { ok: false, error: `${apiError(locale, "missingPaymentConfig")}: ${missing.join(", ")}` },
      { status: 500 },
    );
  }

  // 校验计划
  const [plan] = await db
    .select()
    .from(subscriptionPlans)
    .where(and(eq(subscriptionPlans.id, planId), eq(subscriptionPlans.isActive, true)))
    .limit(1);
  if (!plan) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "planNotFound") },
      { status: 404 },
    );
  }

  const planName = locale === "en" ? plan.nameEn : plan.nameZh;
  const price = (plan.priceRmb / 100).toFixed(2);
  const nonce = crypto.randomBytes(6).toString("hex");
  const orderId = `subscription-${plan.id}-${user.id}-${nonce}`;

  // 已有 active 订阅 → 续订将在到期后生效（中文/英文固定文案）
  const existing = await getActiveSubscription(user.id);
  const renewingNote = existing
    ? locale === "en"
      ? "Your current plan is still active — renewal will apply after it expires."
      : "当前订阅未到期，续订将在到期后生效"
    : null;

  // 调用 xorpay
  const payType = getXorpayPayType();
  const notifyUrl = resolveNotifyUrl();
  const sign = buildXorpaySign({
    name: `VIP ${planName} (${plan.durationDays} days)`,
    pay_type: payType,
    price,
    order_id: orderId,
    notify_url: notifyUrl,
  });

  const { ok, data, error } = await createXorpayOrder({
    order_id: orderId,
    name: `VIP ${planName} (${plan.durationDays} days)`,
    price,
    pay_type: payType,
    notify_url: notifyUrl,
    sign,
  });

  if (!ok) {
    console.error("[subscription/create] XorPay order failed:", error);
    return NextResponse.json(
      { ok: false, error: error ?? apiError(locale, "subscriptionCreateFailed") },
      { status: 502 },
    );
  }

  const d = (data ?? {}) as Record<string, unknown>;
  const info = (d.info ?? {}) as Record<string, unknown>;
  const qr =
    (d.qr ?? d.qrcode ?? d.url ?? d.pay_url ?? d.payurl ?? info.qr ?? info.url ?? info.payurl) as
      | string
      | undefined;
  if (!qr) {
    console.error("[subscription/create] XorPay returned no QR code:", JSON.stringify(d));
    return NextResponse.json(
      { ok: false, error: "XorPay returned no QR code" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    orderId,
    qr,
    payUrl: (d.url ?? d.pay_url ?? info.url ?? null) as string | null,
    amount: plan.priceRmb,
    payType,
    planId: plan.id,
    planName,
    durationDays: plan.durationDays,
    isRenewing: existing !== null,
    renewingNote,
  });
}
