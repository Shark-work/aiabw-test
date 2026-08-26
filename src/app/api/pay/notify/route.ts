import { db, ensureDbSchemaOnce, pool } from "@/db/client";
import { adoptions, cosmetics } from "@/db/schema";
import { eq } from "drizzle-orm";
import { XORPAY_APP_SECRET, md5 } from "@/lib/xorpay";
import { executeBlindboxDraw } from "@/lib/blindbox-draw";
import { postBreedShare } from "@/lib/social-poster";

export const runtime = "nodejs";

/**
 * POST /api/pay/notify  （XorPay 异步回调，application/x-www-form-urlencoded）
 *
 * XorPay 回调字段（官方规范）：aoid / order_id / pay_price / pay_time / more / detail / sign
 * 回调验签拼接顺序（官方规范）：aoid + order_id + pay_price + pay_time + app_secret
 *
 * 1. 验签（不匹配返回非 success，XorPay 将按重试策略重发）；
 * 2. 从 order_id 解析 adoptionId（下单时格式 unlock-<adoptionId>）；
 * 3. 幂等置位 adoptions.is_unlocked + users.is_unlocked（重复回调安全）；
 * 4. 返回 "success"（HTTP 200，正文含 success 即停止重试）。
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

  // 2) 从 order_id 解析订单类型与业务参数（unlock / cosmetic / premium）
  const adoptionMatch = order_id.match(
    /^unlock-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  const cosmeticMatch = order_id.match(
    /^cosmetic-([^-]+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  const premiumMatch = order_id.match(
    /^premium-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  const blindboxMatch = order_id.match(
    /^blindbox-([^-]+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
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
