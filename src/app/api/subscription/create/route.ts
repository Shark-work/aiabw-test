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
  extractJsapiParams,
  getXorpayPayType,
  isValidOpenid,
  isWechatUserAgent,
  resolveNotifyUrl,
} from "@/lib/xorpay";
import crypto from "crypto";

export const runtime = "nodejs";

/**
 * POST /api/subscription/create
 * 请求体：{ planId: 'monthly' | 'quarterly' | 'yearly', openid?: string }
 *
 * 流程：
 *  1. 校验登录、计划存在且 is_active
 *  2. 复用 xorpay 通道：order_id = subscription-<planId>-<userId>-<nonce>
 *  3. 价格与天数完全由 DB 决定（前端不可注入）
 *  4. 如果用户已有 active 订阅，返回 renewingNote 提示，订阅仍可创建
 *     （下次到期日由 xorpay 回调中按 "未到期顺延" 规则处理）
 *
 * 手机端适配（微信长按识别二维码已被官方禁用）——按 UA 分流：
 *  - 微信内置浏览器（UA 含 MicroMessenger）→ pay_type=jsapi + 必传 openid，
 *    返回 channel="jsapi" + jsapiParams（前端 WeixinJSBridge 拉起收银台）；
 *    openid 缺失/非法 → 400 + needOpenid:true（前端据此走 OAuth 授权跳转）。
 *  - 外部浏览器 → 保持 pay_type=native（或 XORPAY_PAY_TYPE 配置），
 *    返回 channel="native" + qr 二维码。
 *  两种模式 notify_url 一致，支付结果均由 /api/pay/notify 异步回调确认。
 */
export async function POST(req: Request) {
  await ensureDbSchemaOnce();
  const locale = resolveLocale(req);

  let body: { planId?: string; openid?: string } = {};
  try {
    body = (await req.json()) as { planId?: string; openid?: string };
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

  // —— 手机端 UA 分流：微信内置浏览器走 JSAPI（需 openid），其余保持 Native 扫码 ——
  const inWechat = isWechatUserAgent(req.headers.get("user-agent"));
  let openid: string | undefined;
  if (inWechat) {
    const rawOpenid = typeof body.openid === "string" ? body.openid.trim() : "";
    if (!isValidOpenid(rawOpenid)) {
      // 前端据此触发 /api/subscription/wechat-oauth 授权跳转获取 openid
      return NextResponse.json(
        { ok: false, error: "need_openid", needOpenid: true },
        { status: 400 },
      );
    }
    openid = rawOpenid;
  }

  // 调用 xorpay（notify_url 两种模式一致，支付结果仍由 /api/pay/notify 异步确认）
  const payType = inWechat ? "jsapi" : getXorpayPayType();
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
    openid,
  });

  if (!ok) {
    console.error("[subscription/create] XorPay order failed:", error);
    return NextResponse.json(
      { ok: false, error: error ?? apiError(locale, "subscriptionCreateFailed") },
      { status: 502 },
    );
  }

  // —— JSAPI：返回收银台参数，前端用 WeixinJSBridge 拉起微信支付 ——
  if (inWechat) {
    const jsapiParams = extractJsapiParams(data);
    if (!jsapiParams) {
      console.error(
        "[subscription/create] XorPay jsapi response missing pay params:",
        JSON.stringify(data),
      );
      return NextResponse.json(
        { ok: false, error: "XorPay returned no JSAPI pay params" },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      channel: "jsapi" as const,
      orderId,
      jsapiParams,
      amount: plan.priceRmb,
      payType,
      planId: plan.id,
      planName,
      durationDays: plan.durationDays,
      isRenewing: existing !== null,
      renewingNote,
    });
  }

  // —— Native：返回二维码（外部浏览器，微信「扫一扫」支付） ——
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
    channel: "native" as const,
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
