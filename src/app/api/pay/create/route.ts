import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { adoptions } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import {
  XORPAY_AID,
  XORPAY_APP_SECRET,
  XORPAY_PRODUCT_NAME,
  buildXorpaySign,
  createXorpayOrder,
  getXorpayPayType,
  resolveNotifyUrl,
} from "@/lib/xorpay";

export const runtime = "nodejs";

const DEFAULT_AMOUNT = 9.9;

/**
 * POST /api/pay/create
 * 请求体：{ adoptionId: string, amount?: number }
 *
 * 1. 校验领养记录存在，且属于当前登录用户；
 * 2. 按 XorPay 规范计算 MD5 签名（name + pay_type + price + order_id + notify_url + app_secret）；
 * 3. 调用 https://xorpay.com/api/pay/{aid} 统一下单；
 * 4. 返回支付二维码内容（qr）给前端渲染。
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const adoptionId =
      typeof body?.adoptionId === "string" ? body.adoptionId.trim() : "";

    if (!adoptionId) {
      return NextResponse.json({ ok: false, error: "adoptionId is required" }, { status: 400 });
    }

    // —— 鉴权：必须登录，且只能为自己的宠物发起支付 ——
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Please sign in first" }, { status: 401 });
    }

    // —— 环境变量防御性检查：缺少任何一项都直接返回 500，避免发起无效请求 ——
    const missing: string[] = [];
    if (!XORPAY_AID) missing.push("XORPAY_AID");
    if (!XORPAY_APP_SECRET) missing.push("XORPAY_SECRET");
    if (!resolveNotifyUrl()) missing.push("XORPAY_NOTIFY_URL");
    if (missing.length > 0) {
      console.error("[pay/create] missing payment config:", missing.join(", "));
      return NextResponse.json(
        { ok: false, error: `Missing payment config: ${missing.join(", ")}` },
        { status: 500 },
      );
    }

    // 首次访问自动建表（幂等）
    await ensureDbSchemaOnce();

    // 校验领养记录存在，且属于当前登录用户
    const [adoption] = await db
      .select({ id: adoptions.id, userId: adoptions.userId })
      .from(adoptions)
      .where(eq(adoptions.id, adoptionId))
      .limit(1);

    if (!adoption) {
      return NextResponse.json({ ok: false, error: "Adoption record not found" }, { status: 404 });
    }
    if (adoption.userId !== user.id) {
      return NextResponse.json(
        { ok: false, error: "You are not allowed to pay for this pet" },
        { status: 403 },
      );
    }

    // 校验金额（默认 9.9 元）
    const rawAmount = body?.amount ?? DEFAULT_AMOUNT;
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid amount" }, { status: 400 });
    }

    const name = XORPAY_PRODUCT_NAME;
    // 归一化支付方式：兼容旧版数字配置（Vercel 环境变量可能仍是 "2"）
    const pay_type = getXorpayPayType();
    const price = amount.toFixed(2);
    // order_id 内嵌 adoptionId（UUID 带横线也用前缀截取法，避免按 - 拆分出错）
    const order_id = `unlock-${adoptionId}`;
    // 回调地址：优先环境变量，占位符/缺失时回退到生产公网地址
    const notify_url = resolveNotifyUrl();

    const sign = buildXorpaySign({ name, pay_type, price, order_id, notify_url });

    console.log(
      "[pay/create] creating XorPay order",
      {
        url: `https://xorpay.com/api/pay/${XORPAY_AID}`,
        order_id,
        name,
        price,
        pay_type,
        notify_url,
      },
    );

    const { ok, data, error } = await createXorpayOrder({
      order_id,
      name,
      price,
      pay_type,
      notify_url,
      sign,
    });

    if (!ok) {
      console.error("[pay/create] XorPay order failed:", error);
      return NextResponse.json({ ok: false, error: error ?? "Order creation failed" }, { status: 502 });
    }

    const d = (data ?? {}) as Record<string, unknown>;
    const info = (d.info ?? {}) as Record<string, unknown>;
    const qr = (d.qr ?? d.qrcode ?? d.url ?? d.pay_url ?? d.payurl ?? info.qr ?? info.url ?? info.payurl) as string | undefined;

    if (!qr) {
      console.error("[pay/create] XorPay returned no QR code:", JSON.stringify(d));
      return NextResponse.json({ ok: false, error: "XorPay returned no QR code" }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      orderId: order_id,
      qr,
      payUrl: (d.url ?? d.pay_url ?? info.url ?? null) as string | null,
      amount,
      payType: pay_type,
    });
  } catch (err) {
    console.error("[pay/create] unhandled exception:", err);
    return NextResponse.json(
      { ok: false, error: "Payment service is temporarily unavailable, check server logs" },
      { status: 500 },
    );
  }
}
