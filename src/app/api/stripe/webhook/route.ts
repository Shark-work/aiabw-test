import { pool, ensureDbSchemaOnce } from "@/db/client";
import { aibiCatch, aibiFail, aibiOk } from "@/lib/aibi-api";
import { constructWebhookEvent, getStripe } from "@/lib/stripe";
import { stripeWebhookSecret } from "@/lib/stripe-config";
import { expireStripeCheckout, fulfillStripeCheckout } from "@/lib/stripe-service";

export const runtime = "nodejs";

/**
 * POST /api/stripe/webhook — Stripe Webhook 端点（服务端对服务端，无用户鉴权，签名校验即鉴权）
 *
 * 监听事件（Dashboard 配置见 docs/stripe-integration.md）：
 *  - checkout.session.completed → 履约：回写用户积分 / 订单状态 paid / 背包道具（事务 + 行锁幂等）
 *  - checkout.session.expired   → 关闭待支付订单（pending → expired）
 *  - 其它事件                    → 200 ignored（不报错，避免无意义重试）
 *
 * 关键约束：
 *  - 必须读取【原始请求体】（req.text()）验签，严禁先 JSON.parse；
 *  - 验签失败/缺签名 → 400；密钥未配置 → 500（非 2xx，Stripe 会按重试策略重发）；
 *  - 履约抛错 → 500（事务已 ROLLBACK，重发可完整重放）；重复事件 → 200 duplicate。
 */
export async function POST(req: Request) {
  try {
    await ensureDbSchemaOnce();

    const webhookSecret = stripeWebhookSecret();
    if (!getStripe() || !webhookSecret) {
      return aibiFail("PAYMENT_NOT_CONFIGURED", 500, req);
    }
    const signature = req.headers.get("stripe-signature");
    if (!signature) return aibiFail("SIGNATURE_INVALID", 400, req);

    const rawBody = await req.text();
    const event = constructWebhookEvent(rawBody, signature, webhookSecret);
    if (!event) return aibiFail("SIGNATURE_INVALID", 400, req);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as {
        id: string;
        payment_status?: string;
        amount_total?: number | null;
        currency?: string | null;
      };
      // 延迟到账类支付方式 complete 但未 paid：不履约，等 Stripe 后续以 paid 状态重发
      if (session.payment_status !== "paid") {
        return aibiOk({ received: true, awaitingPayment: true, sessionId: session.id });
      }
      const result = await fulfillStripeCheckout(pool, session);
      if (result.outcome === "unmatched") {
        // 本地无此订单（如 stripe trigger 的演示事件）：确认收到即可，别让 Stripe 无限重试
        console.warn("[stripe] webhook session unmatched:", session.id);
      }
      return aibiOk({ received: true, ...result });
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as { id: string };
      const expired = await expireStripeCheckout(pool, session.id);
      return aibiOk({ received: true, expired, sessionId: session.id });
    }

    return aibiOk({ received: true, ignored: event.type });
  } catch (err) {
    return aibiCatch(err, req);
  }
}
