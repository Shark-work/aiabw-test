import { NextResponse } from "next/server";

import { isValidOpenid, sanitizeReturnPath } from "@/lib/xorpay";

export const runtime = "nodejs";

/**
 * GET /api/subscription/wechat-oauth/callback?openid=...&return=<站内路径>
 *
 * XorPay 微信 OAuth 回跳：URL 附带 openid。
 * 校验 openid 格式后 302 回前端页面（return 路径 + openid query），
 * 前端订阅页从 URL 读取 openid 存入 sessionStorage 并继续下单。
 * openid 缺失/非法 → 回跳时带 wx_auth=failed，由前端提示重试。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const openid = (url.searchParams.get("openid") ?? "").trim();
  const returnPath = sanitizeReturnPath(url.searchParams.get("return"));

  const target = new URL(returnPath, url.origin);
  if (isValidOpenid(openid)) {
    target.searchParams.set("openid", openid);
  } else {
    target.searchParams.set("wx_auth", "failed");
  }
  return NextResponse.redirect(target, 302);
}
