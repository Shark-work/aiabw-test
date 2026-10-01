/**
 * 艾比平台 Phase 11 · Stripe 订单落库与履约（Webhook 回写核心）
 *
 * 数据流：
 *   create-checkout 路由创建 Checkout Session 后先写 stripe_orders(status='pending')；
 *   Webhook checkout.session.completed 到达 → fulfillStripeCheckout 事务内：
 *     SELECT ... FOR UPDATE 锁单 → status 守卫（仅 pending 可履约）→ 标记 paid
 *     → 按商品类型发放权益（积分 / 卡包入背包 / 道具入背包）→ COMMIT。
 *
 * 幂等（Stripe 至少投递一次 + 重试策略）：
 *   1) 行锁 + status='pending' 守卫 ⇒ 同一 session 权益只发一次，重复事件返回 duplicate；
 *   2) 全部写操作同事务，任一步失败 ROLLBACK，Stripe 重发后可完整重放；
 *   3) 未匹配到本地订单的 session（如 stripe trigger 假事件）返回 unmatched，不报错。
 */
import type { Pool } from "@neondatabase/serverless";

export type StripeFulfillResult = {
  outcome: "fulfilled" | "duplicate" | "unmatched" | "not_pending";
  productType?: string;
  productId?: string | null;
  quantity?: number;
  /** points 类型履约后的积分余额 */
  balance?: number | null;
};

/** create-checkout：写入待支付订单（id = Checkout Session ID，天然幂等键）。 */
export async function createStripeOrder(
  pool: Pool,
  row: {
    id: string;
    userId: string;
    productType: string;
    productId: string | null;
    quantity: number;
    pointsAmount: number | null;
    stripePriceId: string;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO stripe_orders
       (id, user_id, product_type, product_id, quantity, points_amount, stripe_price_id, status)
     VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, 'pending')
     ON CONFLICT (id) DO NOTHING`,
    [row.id, row.userId, row.productType, row.productId, row.quantity, row.pointsAmount, row.stripePriceId],
  );
}

/** Webhook：checkout.session.completed → 事务化履约（回写积分/订单状态/背包）。 */
export async function fulfillStripeCheckout(
  pool: Pool,
  session: { id: string; amount_total?: number | null; currency?: string | null },
): Promise<StripeFulfillResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ord = await client.query(
      `SELECT user_id AS "userId", product_type AS "productType", product_id AS "productId",
              quantity, points_amount AS "pointsAmount", status
         FROM stripe_orders WHERE id = $1 FOR UPDATE`,
      [session.id],
    );
    if (!ord.rows.length) {
      await client.query("ROLLBACK");
      return { outcome: "unmatched" };
    }
    const order = ord.rows[0];
    if (order.status === "paid") {
      await client.query("ROLLBACK");
      return { outcome: "duplicate" };
    }
    if (order.status !== "pending") {
      await client.query("ROLLBACK");
      return { outcome: "not_pending" };
    }

    // 标记已支付 + 回填实收金额/币种（与权益发放同事务）
    await client.query(
      `UPDATE stripe_orders SET status = 'paid', paid_at = now(), amount_total = $2, currency = $3
        WHERE id = $1`,
      [session.id, session.amount_total ?? null, session.currency ?? null],
    );

    let balance: number | null = null;
    if (order.productType === "points") {
      const pts = Number(order.pointsAmount) || 0;
      const upd = await client.query(
        `UPDATE users SET points = points + $1 WHERE id = $2::uuid RETURNING points`,
        [pts, order.userId],
      );
      balance = upd.rows[0]?.points ?? null;
      await client.query(
        `INSERT INTO points_log (user_id, amount, reason) VALUES ($1::uuid, $2, 'stripe_recharge')`,
        [order.userId, pts],
      );
    } else if (order.productType === "pack") {
      // 卡包入背包（与 /api/pack/buy 同构：item_key='pack:'+packId，每包一行，source 区分支付渠道）
      await client.query(
        `INSERT INTO user_items (user_id, item_key, rarity, source)
         SELECT $1::uuid, 'pack:' || $2, 'common', 'stripe_pack' FROM generate_series(1, $3)`,
        [order.userId, order.productId, order.quantity],
      );
    } else if (order.productType === "item") {
      // 道具入背包（与 /api/item/buy 同构：item_key=itemId，每件一行）
      await client.query(
        `INSERT INTO user_items (user_id, item_key, rarity, source)
         SELECT $1::uuid, $2, 'common', 'stripe_item' FROM generate_series(1, $3)`,
        [order.userId, order.productId, order.quantity],
      );
    }

    await client.query("COMMIT");
    return {
      outcome: "fulfilled",
      productType: order.productType,
      productId: order.productId,
      quantity: order.quantity,
      balance,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Webhook：checkout.session.expired → 关闭待支付订单（仅 pending → expired，幂等）。 */
export async function expireStripeCheckout(pool: Pool, sessionId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE stripe_orders SET status = 'expired' WHERE id = $1 AND status = 'pending' RETURNING id`,
    [sessionId],
  );
  return r.rows.length > 0;
}
