import { aibiFail } from "@/lib/aibi-api";

export const runtime = "nodejs";

/**
 * 国内支付通道 · 占位路由（Phase 11 保留接口位）
 *
 * 背景：艾比商业化（积分充值/卡包/道具）本期仅接 Stripe（面向海外支付）；
 * 国内支付（支付宝 / 微信支付 / 合规聚合支付）需待主体资质（ICP、商户号）确定后再接入，
 * 届时在本路由下扩展 create/notify 子路径，对外契约与本占位保持一致。
 *
 * 现状说明：站内 XorPay（/api/pay/*）仅服务「宠物位解锁 / 订阅 / 装扮」老链路，
 * 与艾比商品体系（stripe_orders 履约流）互不耦合。
 *
 * 行为：任意方法一律 501 DOMESTIC_PAYMENT_PENDING + 规划信息（details），
 * 前端可据此展示「国内支付接入中」引导 Stripe 或联系客服。
 */
const PLACEHOLDER_DETAILS = {
  status: "placeholder",
  plannedProviders: ["alipay", "wechat_pay", "aggregate"],
  decisionNote:
    "Pending business-entity qualification: choose Alipay / WeChat Pay direct or a compliant aggregator.",
  existingDomesticChannel: "xorpay (pet-slot / subscription legacy flow only)",
} as const;

/** POST /api/payment/domestic — 占位：501（未实现，通道接入中） */
export async function POST(req: Request) {
  return aibiFail("DOMESTIC_PAYMENT_PENDING", 501, req, PLACEHOLDER_DETAILS);
}

/** GET /api/payment/domestic — 占位信息探测：同样 501 + 规划详情 */
export async function GET(req: Request) {
  return aibiFail("DOMESTIC_PAYMENT_PENDING", 501, req, PLACEHOLDER_DETAILS);
}
