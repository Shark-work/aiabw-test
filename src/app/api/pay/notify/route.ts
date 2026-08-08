import { db } from "@/db/client";
import { adoptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { XORPAY_APP_SECRET, XORPAY_NOTIFY_URL, md5 } from "@/lib/xorpay";

export const runtime = "nodejs";

const SUCCESS_STATUSES = new Set([
  "TRADE_SUCCESS",
  "SUCCESS",
  "PAID",
  "PAY_SUCCESS",
  "1",
]);

/**
 * POST /api/pay/notify  （XorPay 异步回调，form-urlencoded）
 *
 * 1. 读取回调表单；
 * 2. 校验签名：与下单时相同拼接顺序 name + pay_type + price + order_id + notify_url + app_secret
 *    （notify_url 取本机配置值重建，因回调不回传该字段）；
 * 3. 确认订单为支付成功状态；
 * 4. 将对应 adoptionId 的 is_unlocked 置为 true；
 * 5. 返回 "success" 告知 XorPay 处理成功。
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = new URLSearchParams(raw);

  const order_id = params.get("order_id") ?? "";
  const sign = params.get("sign") ?? "";
  const name = params.get("name") ?? "";
  const pay_type = params.get("pay_type") ?? "";
  const price = params.get("price") ?? params.get("money") ?? "";
  const tradeStatus =
    params.get("trade_status") ?? params.get("status") ?? "";

  if (!order_id) {
    return new Response("fail", { status: 200 });
  }

  // 1) 签名校验
  const expected = md5(
    `${name}${pay_type}${price}${order_id}${XORPAY_NOTIFY_URL}${XORPAY_APP_SECRET}`,
  );
  if (!sign || expected.toLowerCase() !== sign.toLowerCase()) {
    return new Response("sign error", { status: 200 });
  }

  // 2) 确认支付成功（否则不处理，等待后续到达）
  if (!SUCCESS_STATUSES.has(tradeStatus.trim().toUpperCase())) {
    return new Response("success", { status: 200 });
  }

  // 3) 从 order_id 解析 adoptionId（下单时格式：unlock-<adoptionId>）
  const PREFIX = "unlock-";
  const adoptionId = order_id.startsWith(PREFIX)
    ? order_id.slice(PREFIX.length)
    : "";

  if (adoptionId) {
    await db
      .update(adoptions)
      .set({ isUnlocked: true })
      .where(eq(adoptions.id, adoptionId));
  }

  return new Response("success", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
