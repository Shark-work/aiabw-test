import { db, ensureDbSchemaOnce, pool } from "@/db/client";
import { adoptions, cosmetics } from "@/db/schema";
import { eq } from "drizzle-orm";
import { XORPAY_APP_SECRET, md5 } from "@/lib/xorpay";
import { executeBlindboxDraw } from "@/lib/blindbox-draw";
import { findPointsPack } from "@/lib/points-recharge";
import { MAKEUP_ORDER_RE } from "@/lib/checkin-makeup";
import { postBreedShare } from "@/lib/social-poster";
import { todayString } from "@/lib/chat-quota-config";
import { PROMOTE_CONTENT_TYPE } from "@/lib/leaderboard";
import { PROMO_CASH_HOURS, VIP_YEARLY_DAYS } from "@/lib/monetization-products";

export const runtime = "nodejs";

/**
 * POST /api/pay/notify  （XorPay 异步回调，application/x-www-form-urlencoded）
 *
 * XorPay 回调字段（官方规范）：aoid / order_id / pay_price / pay_time / more / detail / sign
 * 回调验签拼接顺序（官方规范）：aoid + order_id + pay_price + pay_time + app_secret
 *
 * 1. 验签（不匹配返回非 success，XorPay 将按重试策略重发）；
 * 2. 从 order_id 解析订单类型与业务参数（各 kind 前缀见下方正则）；
 * 3. 按类型幂等发货（重复回调安全：唯一约束 / ON CONFLICT / 条件更新）；
 * 4. 返回 "success"（HTTP 200，正文含 success 即停止重试）。
 *
 * 事件覆盖说明（Phase 6 · 实施计划 8.1.2）：
 *  - payment.success：XorPay 个人码唯一推送的事件（支付成功回调），本路由全量分发；
 *  - payment.failed：XorPay 无失败回调 —— 未支付订单不下发二维码即自然过期，
 *    无资金/库存副作用，无需处理；
 *  - payment.refunded：XorPay 无退款回调渠道 —— 退款走人工核对后，经
 *    /api/admin/users/[id]/points 手动扣分与状态回收，points_log 留痕对账。
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = new URLSearchParams(raw);

  const aoid = params.get("aoid") ?? "";
  const order_id = params.get("order_id") ?? "";
  const pay_price = params.get("pay_price") ?? params.get("price") ?? "";
  const pay_time = params.get("pay_time") ?? "";
  const sign = params.get("sign") ?? "";

  if (!order_id || !aoid) {
    console.warn("[pay/notify] missing required params", { aoid, order_id });
    return new Response("fail", { status: 200 });
  }

  // 1) 官方验签：md5(aoid + order_id + pay_price + pay_time + app_secret)
  const expected = md5(
    `${aoid}${order_id}${pay_price}${pay_time}${XORPAY_APP_SECRET}`,
  );
  if (!sign || expected !== sign.toLowerCase()) {
    console.warn("[pay/notify] sign verification FAILED", {
      aoid,
      order_id,
      pay_price,
      pay_time,
    });
    return new Response("sign error", { status: 200 });
  }

  console.log("[pay/notify] valid payment callback received", {
    aoid,
    order_id,
    pay_price,
    pay_time,
  });

  // 2) 从 order_id 解析订单类型与业务参数（unlock / cosmetic / premium / subscription / blindbox / points）
  const adoptionMatch = order_id.match(
    /^unlock-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  const cosmeticMatch = order_id.match(
    /^cosmetic-([^-]+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  const premiumMatch = order_id.match(
    /^premium-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  // subscription-<planId>-<userId>-<nonce>  planId ∈ {monthly, quarterly, yearly}
  const subscriptionMatch = order_id.match(
    /^subscription-(monthly|quarterly|yearly)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  const blindboxMatch = order_id.match(
    /^blindbox-([^-]+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  // points-<points>-<userId>-<nonce>  积分充值（points 对应服务端档位表）
  const pointsMatch = order_id.match(
    /^points-(\d+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  // checkin-makeup-<userId>-<yyyy-mm-dd>-<nonce>  断签补签（补签日期下单时固化进订单号）
  const makeupMatch = order_id.match(MAKEUP_ORDER_RE);
  // —— Phase 6 新商品（订单号格式见 src/lib/monetization-products.ts）——
  // premium-yearly-<userId>-<nonce>  高级公民年卡
  const premiumYearlyMatch = order_id.match(
    /^premium-yearly-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  // breedaccel-<collectibleId>-<userId>-<nonce>  结晶加速
  const breedAccelMatch = order_id.match(
    /^breedaccel-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  // chatpack-<messages>-<userId>-<nonce>  聊天包（messages 为下单时固化的句数）
  const chatPackMatch = order_id.match(
    /^chatpack-(\d+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  // promo24-<contentId>-<userId>-<nonce>  推荐曝光 24h 现金通道
  const promo24Match = order_id.match(
    /^promo24-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  const adoptionId = adoptionMatch ? adoptionMatch[1] : "";

  // 首次访问自动建表（幂等）
  await ensureDbSchemaOnce();

  if (cosmeticMatch) {
    // —— 装扮购买：为宠物绑定外观（幂等：唯一索引 ON CONFLICT DO NOTHING）——
    const cosmeticId = cosmeticMatch[1];
    const petAdoptionId = cosmeticMatch[2];
    const [cosmetic] = await db
      .select({ id: cosmetics.id })
      .from(cosmetics)
      .where(eq(cosmetics.id, cosmeticId))
      .limit(1);
    if (cosmetic) {
      // 通过领养记录反查买家（排除游客）
      const { rows } = await pool.query(
        `SELECT user_id::uuid AS "userId" FROM adoptions WHERE id = $1 AND user_id <> 'anonymous' LIMIT 1`,
        [petAdoptionId],
      );
      const userId = rows[0]?.userId;
      if (userId) {
        await pool.query(
          `INSERT INTO user_cosmetics (user_id, cosmetic_id, adoption_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, cosmetic_id, adoption_id) DO NOTHING`,
          [userId, cosmeticId, petAdoptionId],
        );
        console.log("[pay/notify] cosmetic granted", { cosmeticId, adoptionId: petAdoptionId, userId });
      }
    }
  } else if (premiumMatch) {
    // —— 高级公民月卡：premium_until 向后顺延 30 天（续费累计，不因重复回调缩短）——
    const userId = premiumMatch[1];
    await pool.query(
      `UPDATE users
          SET premium_until = GREATEST(COALESCE(premium_until, now()), now())
                              + interval '30 days'
        WHERE id = $1::uuid`,
      [userId],
    );
    console.log("[pay/notify] premium granted", { userId });
  } else if (subscriptionMatch) {
    // —— VIP 订阅：UPSERT user_subscriptions（未到期则向后顺延；已到期则从现在起算）——
    const planId = subscriptionMatch[1];
    const userId = subscriptionMatch[2];
    // durationDays: 30 / 90 / 365
    const durationDays = planId === "yearly" ? 365 : planId === "quarterly" ? 90 : 30;
    const subscriptionId = `sub-${order_id}`;
    await pool.query(
      `INSERT INTO user_subscriptions (id, user_id, plan_id, status, started_at, expires_at, payment_id, auto_renew)
       VALUES (
         $1, $2::uuid, $3, 'active', now(),
         now() + ($4 || ' days')::interval,
         $5, true
       )
       ON CONFLICT (id) DO UPDATE
         SET expires_at = GREATEST(user_subscriptions.expires_at, now())
                          + ($4 || ' days')::interval,
             status = 'active'`,
      [subscriptionId, userId, planId, String(durationDays), order_id],
    );
    console.log("[pay/notify] subscription granted", { planId, userId, orderId: order_id });
  } else if (blindboxMatch) {
    // —— 盲盒抽奖（XorPay 通道）：支付确认后，事务内抽奖 + 铸造 + 写流水 ——
    const bbPoolId = blindboxMatch[1];
    const bbUserId = blindboxMatch[2];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // 幂等：同一 order_id 重复回调 → executeBlindboxDraw 返回 null（不重复抽）
      const result = await executeBlindboxDraw(client, {
        userId: bbUserId,
        poolId: bbPoolId,
        payMethod: "xorpay",
        cost: Number(pay_price || 0),
        orderId: order_id,
      });
      await client.query("COMMIT");
      if (result) {
        if (result.isLegendary) {
          void postBreedShare({
            speciesName: result.speciesNameZh,
            rarity: "legendary",
            element: result.element,
            generation: 1,
            hashId: result.hashId,
          }).catch((err) => console.error("[pay/notify] blindbox 社交分享异常(非阻塞):", err));
        }
        console.log("[pay/notify] blindbox drawn", { poolId: bbPoolId, hashId: result.hashId, isLegendary: result.isLegendary });
      } else {
        console.log("[pay/notify] blindbox idempotent skip (already drawn)", { orderId: order_id });
      }
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      // 真实失败 → 返回非 success 让 XorPay 重试；已抽（幂等 null）不在此路径
      console.error("[pay/notify] blindbox draw failed:", err);
      return new Response("fail", { status: 200 });
    } finally {
      client.release();
    }
  } else if (pointsMatch) {
    // —— 积分充值：单条 CTE 原子完成「幂等登记 + 入账」——
    // points_log.ref 唯一索引兜底：同一 order_id 重复回调 → INSERT 冲突返回空 → UPDATE 不执行，
    // 无论回调多少次积分只入账一次（exactly-once）。
    const pack = findPointsPack(Number(pointsMatch[1]));
    const userId = pointsMatch[2];
    if (!pack) {
      // 非本站档位表生成的订单号（防伪造纵深）：不入账，但仍返回 success 终止 XorPay 重试
      console.warn("[pay/notify] points order with unknown pack, skipped", { order_id });
    } else {
      const { rowCount } = await pool.query(
        `WITH ins AS (
           INSERT INTO points_log (user_id, amount, reason, ref)
           VALUES ($1::uuid, $2, 'recharge', $3)
           ON CONFLICT (ref) DO NOTHING
           RETURNING 1
         )
         UPDATE users SET points = points + $2
         WHERE id = $1::uuid AND EXISTS (SELECT 1 FROM ins)`,
        [userId, pack.points, order_id],
      );
      if ((rowCount ?? 0) > 0) {
        console.log("[pay/notify] points credited", {
          userId,
          points: pack.points,
          orderId: order_id,
          payPrice: pay_price,
        });
      } else {
        console.log("[pay/notify] points no-op (duplicate callback or user missing)", { orderId: order_id });
      }

      // —— 首充双倍（产品升级 Phase 4）：本单确已入账（paid）且从未首充 → 等额 bonus 入账 ——
      // 设计要点：
      //  1) 不依赖主 CTE 的 rowCount —— 若首回调在主入账后、bonus 前崩溃，重试回调时
      //     主 CTE 因 ref 冲突 no-op，此处 paid 子查询仍命中本单 → bonus 幂等补发；
      //  2) first_purchase user_id 主键 ON CONFLICT DO NOTHING —— 一人终身一次首充；
      //  3) points_log ref='first-purchase:<order_id>' 唯一索引兜底 —— 并发/重放不多发；
      //  4) bonus 金额 = pack.points（服务端档位表裁定，双倍见 FIRST_PURCHASE_BONUS_MULTIPLIER）。
      const bonusRes = await pool.query(
        `WITH paid AS (
           SELECT 1 FROM points_log WHERE ref = $3 AND reason = 'recharge'
         ), fp AS (
           INSERT INTO first_purchase (user_id, package_type, points_received, bonus_points)
           SELECT $1::uuid, $2, $4, $4 FROM paid
           ON CONFLICT (user_id) DO NOTHING
           RETURNING user_id
         ), bonus AS (
           INSERT INTO points_log (user_id, amount, reason, ref)
           SELECT $1::uuid, $4, 'first_purchase_bonus', $5 FROM fp
           ON CONFLICT (ref) DO NOTHING
           RETURNING 1
         )
         UPDATE users SET points = points + $4
          WHERE id = $1::uuid AND EXISTS (SELECT 1 FROM bonus)`,
        [userId, `points-${pack.points}`, order_id, pack.points, `first-purchase:${order_id}`],
      );
      if ((bonusRes.rowCount ?? 0) > 0) {
        console.log("[pay/notify] first-purchase bonus credited", {
          userId,
          bonus: pack.points,
          orderId: order_id,
        });
      }
    }
  } else if (makeupMatch) {
    // —— 断签补签：回填 last_checkin_date = 下单时固化的昨天 ——
    // 幂等 + 只前进：重复回调 / 用户已签到更晚日期 → UPDATE 条件不满足 → no-op，不多生效；
    // streak 不在此修改（签到连签判定只看 last_checkin_date 是否昨天，用户当天签到即自然 +1 延续）。
    const muUserId = makeupMatch[1];
    const muDate = makeupMatch[2];
    const { rowCount } = await pool.query(
      `UPDATE users SET last_checkin_date = $2
         WHERE id = $1::uuid AND (last_checkin_date IS NULL OR last_checkin_date < $2)`,
      [muUserId, muDate],
    );
    if ((rowCount ?? 0) > 0) {
      console.log("[pay/notify] checkin makeup granted", { userId: muUserId, makeupDate: muDate, orderId: order_id });
    } else {
      console.log("[pay/notify] checkin makeup no-op (duplicate callback or already checked later)", { orderId: order_id });
    }
  } else if (premiumYearlyMatch) {
    // —— Phase 6 高级公民年卡：premium_until 顺延 365 天（续费累计，GREATEST 不缩短现有权益）——
    // 幂等：points_log ref=<order_id> 唯一索引兜底，重复回调 / 重放不多顺延。
    const userId = premiumYearlyMatch[1];
    const { rowCount } = await pool.query(
      `WITH ins AS (
         INSERT INTO points_log (user_id, amount, reason, ref)
         VALUES ($1::uuid, 0, 'vip_yearly', $2)
         ON CONFLICT (ref) DO NOTHING
         RETURNING 1
       )
       UPDATE users
          SET premium_until = GREATEST(COALESCE(premium_until, now()), now()) + make_interval(days => $3)
        WHERE id = $1::uuid AND EXISTS (SELECT 1 FROM ins)`,
      [userId, order_id, VIP_YEARLY_DAYS],
    );
    if ((rowCount ?? 0) > 0) {
      console.log("[pay/notify] vip yearly granted", { userId, days: VIP_YEARLY_DAYS, orderId: order_id });
    } else {
      console.log("[pay/notify] vip yearly no-op (duplicate callback)", { orderId: order_id });
    }
  } else if (breedAccelMatch) {
    // —— Phase 6 结晶加速：清除目标藏品 breed_cooldown_until ——
    // 幂等关键：必须先记账再发货（CTE 顺序）——若先清冷却再重复回调，会把用户
    // 加速后新产生的冷却误清。points_log ref 唯一索引保证一单一效。
    const collectibleId = breedAccelMatch[1];
    const userId = breedAccelMatch[2];
    const { rowCount } = await pool.query(
      `WITH ins AS (
         INSERT INTO points_log (user_id, amount, reason, ref)
         VALUES ($2::uuid, 0, 'breed_accel', $1)
         ON CONFLICT (ref) DO NOTHING
         RETURNING 1
       )
       UPDATE user_collectibles SET breed_cooldown_until = now()
        WHERE id = $3::uuid AND owner_id = $2::uuid AND EXISTS (SELECT 1 FROM ins)`,
      [order_id, userId, collectibleId],
    );
    if ((rowCount ?? 0) > 0) {
      console.log("[pay/notify] breed accel applied", { userId, collectibleId, orderId: order_id });
    } else {
      console.log("[pay/notify] breed accel no-op (duplicate callback or target missing)", { orderId: order_id });
    }
  } else if (chatPackMatch) {
    // —— Phase 6 聊天包：当日已用额度回充 N 句（等价当日限额 +N）——
    // 口径：chat_quotas 记「已用句数」，回充 = message_count -N（GREATEST 防负）；
    // 当日无行（免费额度未动用）→ 插入 0 行（无害，额度本就充足）。
    // 幂等：points_log ref 唯一索引兜底，重复回调不多充。日期与 /api/chat 同源（todayString UTC）。
    const messages = Number(chatPackMatch[1]);
    const userId = chatPackMatch[2];
    const today = todayString();
    const { rowCount } = await pool.query(
      `WITH ins AS (
         INSERT INTO points_log (user_id, amount, reason, ref)
         VALUES ($1::uuid, 0, 'chat_pack', $2)
         ON CONFLICT (ref) DO NOTHING
         RETURNING 1
       )
       INSERT INTO chat_quotas (id, user_id, date, message_count, last_message_at)
       SELECT $3, $1::uuid, $4, 0, now() WHERE EXISTS (SELECT 1 FROM ins)
       ON CONFLICT (user_id, date)
       DO UPDATE SET message_count = GREATEST(0, chat_quotas.message_count - $5)`,
      [userId, order_id, `quota-${userId}-${today}`, today, messages],
    );
    if ((rowCount ?? 0) > 0) {
      console.log("[pay/notify] chat pack credited", { userId, messages, date: today, orderId: order_id });
    } else {
      console.log("[pay/notify] chat pack no-op (duplicate callback)", { orderId: order_id });
    }
  } else if (promo24Match) {
    // —— Phase 6 推荐曝光现金通道：写 promoted_content（24h，priority=1 与积分 1 天档一致）——
    // 幂等：points_log ref 唯一索引兜底。NOT EXISTS 防并发撞车：支付完成后若该藏品
    // 已有生效推广（如等待支付期间又买了积分版）→ 不再插入，points_log 留痕人工对账。
    const contentId = promo24Match[1];
    const userId = promo24Match[2];
    const { rowCount } = await pool.query(
      `WITH ins AS (
         INSERT INTO points_log (user_id, amount, reason, ref)
         VALUES ($1::uuid, 0, 'promotion_purchase', $2)
         ON CONFLICT (ref) DO NOTHING
         RETURNING 1
       )
       INSERT INTO promoted_content (content_type, content_id, promoter_id, start_time, end_time, priority)
       SELECT $3, $4::uuid, $1::uuid, now(), now() + make_interval(hours => $5), 1
        WHERE EXISTS (SELECT 1 FROM ins)
          AND NOT EXISTS (
            SELECT 1 FROM promoted_content pc
             WHERE pc.content_type = $3 AND pc.content_id = $4::uuid AND pc.end_time > now()
          )`,
      [userId, order_id, PROMOTE_CONTENT_TYPE, contentId, PROMO_CASH_HOURS],
    );
    if ((rowCount ?? 0) > 0) {
      console.log("[pay/notify] promo24 activated", { userId, contentId, hours: PROMO_CASH_HOURS, orderId: order_id });
    } else {
      console.log("[pay/notify] promo24 no-op (duplicate callback or active promotion exists)", { orderId: order_id });
    }
  } else if (adoptionId) {
    // 解锁该宠物（畅聊解锁）
    await db
      .update(adoptions)
      .set({ isUnlocked: true })
      .where(eq(adoptions.id, adoptionId));

    // 全局解锁：该宠物主人永久获得多宠权限（排除游客 user_id='anonymous'，
    // 且用子查询保证 uuid 转换安全：游客不是合法 uuid）
    await pool.query(
      `UPDATE users SET is_unlocked = true
         WHERE id = (
           SELECT user_id::uuid FROM adoptions
           WHERE id = $1 AND user_id <> 'anonymous'
         )`,
      [adoptionId],
    );
  }

  return new Response("success", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
