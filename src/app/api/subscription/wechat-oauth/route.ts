import { NextResponse } from "next/server";

import { XORPAY_AID, buildXorpayOpenidUrl, sanitizeReturnPath } from "@/lib/xorpay";

export const runtime = "nodejs";

/**
 * GET /api/subscription/wechat-oauth?return=<站内路径>
 *
 * 微信内置浏览器中 JSAPI 支付前置步骤：通过 XorPay 的微信 OAuth 拿 openid。
 * 302 → https://xorpay.com/api/openid/{aid}?callback=<本站 callback 绝对地址>
 * 微信授权完成后 XorPay 会 302 回跳 callback 并附带 openid 参数，
 * callback 再把 openid 拼回前端页面（见 ./callback/route.ts）。
 */
export async function GET(req: Request) {
  if (!XORPAY_AID) {
    return NextResponse.json(
      { ok: false, error: "XORPAY_AID is not configured" },
      { status: 500 },
    );
  }
  const url = new URL(req.url);
  const returnPath = sanitizeReturnPath(url.searchParams.get("return"));
  const callback = new URL("/api/subscription/wechat-oauth/callback", url.origin);
  callback.searchParams.set("return", returnPath);
  return NextResponse.redirect(buildXorpayOpenidUrl(callback.toString()), 302);
}
