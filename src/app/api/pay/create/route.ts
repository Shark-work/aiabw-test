import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { adoptions } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import {
  XORPAY_AID,
  XORPAY_APP_SECRET,
  XORPAY_NOTIFY_URL,
  XORPAY_PAY_TYPE,
  XORPAY_PRODUCT_NAME,
  buildXorpaySign,
  createXorpayOrder,
} from "@/lib/xorpay";

export const runtime = "nodejs";

const DEFAULT_AMOUNT = 9.9;

/**
 * POST /api/pay/create
 * 请求体：{ adoptionId: string, amount?: number }
 *
 * 1. 校验领养记录存在；
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
      return NextResponse.json({ ok: false, error: "缺少 adoptionId" }, { status: 400 });
    }

    // —— 鉴权：必须登录，且只能为自己的宠物发起支付 ——
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
    }

    // —— 环境变量防御性检查：缺少任何一项都直接返回 500，避免发起无效请求 ——
    const missing: string[] = [];
    if (!XORPAY_AID) missing.push("XORPAY_AID");
    if (!XORPAY_APP_SECRET) missing.push("XORPAY_SECRET");
    if (!XORPAY_NOTIFY_URL) missing.push("XORPAY_NOTIFY_URL");
    if (missing.length > 0) {
      console.error("[pay/create] 缺少支付配置:", missing.join(", "));
      return NextResponse.json(
        { ok: false, error: `缺少支付配置：${missing.join(", ")}` },
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
      return NextResponse.json({ ok: false, error: "未找到该领养记录" }, { status: 404 });
    }
    if (adoption.userId !== user.id) {
      return NextResponse.json(
        { ok: false, error: "无权为该宠物发起支付" },
        { status: 403 },
      );
    }

    // 校验金额（默认 9.9 元）
    const rawAmount = body?.amount ?? DEFAULT_AMOUNT;
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ ok: false, error: "金额不合法" }, { status: 400 });
    }

    const name = XORPAY_PRODUCT_NAME;
    const pay_type = XORPAY_PAY_TYPE;
    const price = amount.toFixed(2);
    // order_id 内嵌 adoptionId（UUID 带横线也用前缀截取法，避免按 - 拆分出错）
    const order_id = `unlock-${adoptionId}`;
    const notify_url = XORPAY_NOTIFY_URL;

    const sign = buildXorpaySign({ name, pay_type, price, order_id, notify_url });

    console.log(
      "[pay/create] 发起 XorPay 下单",
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
      console.error("[pay/create] XorPay 下单失败:", error);
      return NextResponse.json({ ok: false, error: error ?? "下单失败" }, { status: 502 });
    }

    const d = (data ?? {}) as Record<string, unknown>;
    const qr = (d.qr ?? d.qrcode ?? d.url ?? d.pay_url ?? d.payurl) as string | undefined;

    if (!qr) {
      console.error("[pay/create] XorPay 未返回支付二维码:", JSON.stringify(d));
      return NextResponse.json({ ok: false, error: "XorPay 未返回支付二维码" }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      orderId: order_id,
      qr,
      payUrl: (d.url ?? d.pay_url ?? null) as string | null,
      amount,
      payType: pay_type,
    });
  } catch (err) {
    console.error("[pay/create] 未捕获异常:", err);
    return NextResponse.json(
      { ok: false, error: "支付服务暂时不可用，请检查后台日志" },
      { status: 500 },
    );
  }
}
