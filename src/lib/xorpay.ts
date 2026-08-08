import crypto from "crypto";

/**
 * XorPay（码支付）接入助手。
 *
 * 环境变量：
 *   - XORPAY_AID          商户应用 ID（下单接口路径中的 {aid}）
 *   - XORPAY_APP_SECRET   应用密钥，用于签名
 *   - XORPAY_NOTIFY_URL   异步回调地址（完整公网 URL，/api/pay/notify）
 *   - XORPAY_PAY_TYPE     支付方式，默认 "2"（1=支付宝，2=微信，3=QQ 钱包）
 *   - XORPAY_PRODUCT_NAME 商品名称，默认「解锁艾比无限畅聊」
 */

export const XORPAY_AID = process.env.XORPAY_AID ?? "";
export const XORPAY_APP_SECRET =
  process.env.XORPAY_APP_SECRET ?? process.env.XORPAY_SECRET ?? "";
export const XORPAY_NOTIFY_URL = process.env.XORPAY_NOTIFY_URL ?? "";
export const XORPAY_PAY_TYPE = process.env.XORPAY_PAY_TYPE ?? "2";
export const XORPAY_PRODUCT_NAME =
  process.env.XORPAY_PRODUCT_NAME ?? "解锁艾比无限畅聊";

export function md5(input: string): string {
  return crypto.createHash("md5").update(input, "utf8").digest("hex");
}

/**
 * 计算 XorPay MD5 签名。
 * 按规范将参数按以下顺序拼接后取 MD5：
 *   name + pay_type + price + order_id + notify_url + app_secret
 */
export function buildXorpaySign(params: {
  name: string;
  pay_type: string;
  price: string;
  order_id: string;
  notify_url: string;
  app_secret?: string;
}): string {
  const secret = params.app_secret ?? XORPAY_APP_SECRET;
  const raw =
    `${params.name}${params.pay_type}${params.price}` +
    `${params.order_id}${params.notify_url}${secret}`;
  return md5(raw);
}

/**
 * 统一下单：POST https://xorpay.com/api/pay/{aid}
 * Content-Type: application/x-www-form-urlencoded
 */
export async function createXorpayOrder(fields: {
  order_id: string;
  name: string;
  price: string;
  pay_type: string;
  notify_url: string;
  sign: string;
  app_secret?: string;
}): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!XORPAY_AID) {
    return { ok: false, error: "未配置 XORPAY_AID" };
  }

  const body = new URLSearchParams({
    order_id: fields.order_id,
    name: fields.name,
    price: fields.price,
    pay_type: fields.pay_type,
    notify_url: fields.notify_url,
    sign: fields.sign,
    sign_type: "MD5",
    app_secret: fields.app_secret ?? XORPAY_APP_SECRET,
  }).toString();

  try {
    const res = await fetch(`https://xorpay.com/api/pay/${XORPAY_AID}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `XorPay 响应异常 ${res.status}: ${text}` };
    }

    // 防御性解析：XorPay 可能返回非 JSON（如 HTML 错误页），此时捕获原始文本便于排查。
    let data: { status?: number | string; [k: string]: unknown };
    try {
      data = (await res.json()) as { status?: number | string; [k: string]: unknown };
    } catch {
      const text = await res.text();
      return {
        ok: false,
        error: `XorPay 返回非 JSON 响应: ${text.slice(0, 300)}`,
      };
    }

    // XorPay 以 status === 1 表示下单成功。
    const ok = data?.status === 1 || data?.status === "1";
    return { ok, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "XorPay 请求失败",
    };
  }
}
