/**
 * 艾比平台 Phase 11 · Stripe 服务端客户端（懒加载单例 + Webhook 验签封装）
 *
 * 设计要点：
 *  - 懒加载 + 缓存：模块 import 不读 env、不抛异常（契约测试可无 key 导入）；
 *    首次 getStripe() 时才解析 STRIPE_SECRET_KEY，未配置返回 null，
 *    由路由层统一降级为 503/500 PAYMENT_NOT_CONFIGURED。
 *  - 本文件仅在服务端使用（route handlers）；密钥绝不进入客户端 bundle。
 */
import Stripe from "stripe";

import { stripeSecretKey } from "./stripe-config";

let cached: Stripe | null | undefined;

/** 获取 Stripe 客户端；STRIPE_SECRET_KEY 未配置时返回 null（优雅降级，不抛）。 */
export function getStripe(): Stripe | null {
  if (cached === undefined) {
    const key = stripeSecretKey();
    cached = key ? new Stripe(key) : null;
  }
  return cached;
}

/**
 * Webhook 签名校验：原始报文 + stripe-signature 头 + STRIPE_WEBHOOK_SECRET。
 * 成功返回事件对象；验签失败返回 null（路由返回 400，Stripe 将按重试策略重发）。
 * ⚠️ rawBody 必须是未解析的原始请求体（req.text()），JSON.parse 后再序列化会破坏签名。
 */
export function constructWebhookEvent(
  rawBody: string,
  signature: string,
  webhookSecret: string,
): Stripe.Event | null {
  const stripe = getStripe();
  if (!stripe) return null;
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error(
      "[stripe] webhook signature verification failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
