import { z } from "zod";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { aibiCatch, aibiFail, aibiLocale, aibiOk, parseBody, AibiError } from "@/lib/aibi-api";
import { getStripe } from "@/lib/stripe";
import {
  buildCheckoutReturnUrls,
  resolvePriceId,
  STRIPE_POINTS_PER_UNIT,
} from "@/lib/stripe-config";
import { createStripeOrder } from "@/lib/stripe-service";

export const runtime = "nodejs";

const bodySchema = z.object({
  type: z.enum(["points", "pack", "item"]),
  packId: z.string().min(1).optional(),
  itemId: z.string().min(1).optional(),
  quantity: z.number().int().min(1).max(99).default(1),
});

/**
 * POST /api/stripe/create-checkout — 创建 Stripe Checkout Session（需登录）
 * 请求体：{ type: "points" | "pack" | "item", packId?, itemId?, quantity? }
 *  - points：积分充值，每单位到账 STRIPE_POINTS_PER_UNIT 积分（金额由 Price 配置）；
 *  - pack：卡包购买（packId 须为在售 aibi_packs）；item：道具购买（itemId 须存在于 aibi_items）。
 * 流程：校验商品 → 创建 Session（metadata 携带履约信息）→ 落库 stripe_orders(pending)
 *      → 返回 Checkout URL；支付结果由 /api/stripe/webhook 异步回写（唯一履约入口）。
 * 返回：{ data: { url, sessionId, expiresAt } }
 * 降级：STRIPE_SECRET_KEY / 对应 Price ID 未配置 → 503 PAYMENT_NOT_CONFIGURED（不影响其它功能）。
 */
export async function POST(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const user = await getUserFromRequest(req);
    if (!user) return aibiFail("UNAUTHORIZED", 401, req);

    // 先入参校验（fail fast：非法请求无论支付通道是否配置都返回 400）
    const body = await parseBody(req, bodySchema);

    const stripe = getStripe();
    if (!stripe) return aibiFail("PAYMENT_NOT_CONFIGURED", 503, req);

    // 按商品类型校验目标并计算履约快照（pointsAmount 落库，webhook 不重算）
    let productId: string | null = null;
    let pointsAmount: number | null = null;
    if (body.type === "points") {
      pointsAmount = body.quantity * STRIPE_POINTS_PER_UNIT;
    } else if (body.type === "pack") {
      if (!body.packId) throw new AibiError("VALIDATION_ERROR", 400);
      const r = await pool.query(`SELECT 1 FROM aibi_packs WHERE id = $1 AND status = 'active'`, [body.packId]);
      if (!r.rows.length) throw new AibiError("PACK_NOT_FOUND", 404);
      productId = body.packId;
    } else {
      if (!body.itemId) throw new AibiError("VALIDATION_ERROR", 400);
      const r = await pool.query(`SELECT 1 FROM aibi_items WHERE id = $1`, [body.itemId]);
      if (!r.rows.length) throw new AibiError("ITEM_NOT_FOUND", 404);
      productId = body.itemId;
    }

    const priceId = resolvePriceId(body.type);
    if (!priceId) return aibiFail("PAYMENT_NOT_CONFIGURED", 503, req);

    const origin = new URL(req.url).origin;
    const { successUrl, cancelUrl } = buildCheckoutReturnUrls(origin, aibiLocale(req));
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: body.quantity }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: user.id,
      metadata: {
        userId: user.id,
        type: body.type,
        productId: productId ?? "",
        quantity: String(body.quantity),
        pointsAmount: String(pointsAmount ?? 0),
      },
    });
    if (!session.url) throw new AibiError("INTERNAL_ERROR", 500);

    await createStripeOrder(pool, {
      id: session.id,
      userId: user.id,
      productType: body.type,
      productId,
      quantity: body.quantity,
      pointsAmount,
      stripePriceId: priceId,
    });

    return aibiOk({ url: session.url, sessionId: session.id, expiresAt: session.expires_at ?? null });
  } catch (err) {
    return aibiCatch(err, req);
  }
}
