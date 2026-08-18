import { db, ensureDbSchemaOnce, pool } from "@/db/client";
import { adoptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { XORPAY_APP_SECRET, md5 } from "@/lib/xorpay";

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

  // 2) 从 order_id 解析 adoptionId（下单时格式：unlock-<adoptionId>）
  const PREFIX = "unlock-";
  const adoptionId = order_id.startsWith(PREFIX)
    ? order_id.slice(PREFIX.length)
    : "";

  // 首次访问自动建表（幂等）
  await ensureDbSchemaOnce();

  if (adoptionId) {
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
