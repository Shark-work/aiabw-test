import crypto from "crypto";

/**
 * XorPay（码支付）接入助手。
 *
 * 环境变量：
 *   - XORPAY_AID          商户应用 ID（下单接口路径中的 {aid}）
 *   - XORPAY_APP_SECRET   应用密钥，用于签名
 *   - XORPAY_NOTIFY_URL   异步回调地址（完整公网 URL，/api/pay/notify）
 *   - XORPAY_PAY_TYPE     支付方式，默认 "native"（native=微信扫码，alipay=支付宝当面付）
 *   - XORPAY_PRODUCT_NAME 商品名称，默认 "Unlock Unlimited Pet Slots"
 */

export const XORPAY_AID = process.env.XORPAY_AID ?? "";
export const XORPAY_APP_SECRET =
  process.env.XORPAY_APP_SECRET ?? process.env.XORPAY_SECRET ?? "";
export const XORPAY_NOTIFY_URL = process.env.XORPAY_NOTIFY_URL ?? "";
export const XORPAY_PAY_TYPE = process.env.XORPAY_PAY_TYPE ?? "native";
export const XORPAY_PRODUCT_NAME =
  process.env.XORPAY_PRODUCT_NAME ?? "Unlock Unlimited Pet Slots";

/** 生产环境回调地址（兜底）。 */
const NOTIFY_FALLBACK_URL = "https://www.aiabw.com/api/pay/notify";
/** 占位/本机地址，命中则视为“环境变量未配置正确”，需回退。 */
const PLACEHOLDER_RE = /yourdomain\.com|localhost|127\.0\.0\.1|example\.com/i;

/**
 * 解析下单时使用的 notify_url：
 * 优先使用环境变量 XORPAY_NOTIFY_URL；若缺失或仍是占位符
 * （yourdomain.com / localhost 等），回退到生产公网地址，
 * 确保 XorPay 异步回调一定能回到本服务（支付闭环的关键一环）。
 */
export function resolveNotifyUrl(): string {
  if (XORPAY_NOTIFY_URL && !PLACEHOLDER_RE.test(XORPAY_NOTIFY_URL)) {
    return XORPAY_NOTIFY_URL;
  }
  return NOTIFY_FALLBACK_URL;
}

/** XorPay API 当前接受的 pay_type 值。 */
const VALID_PAY_TYPES = new Set([
  "native",
  "jsapi",
  "alipay",
  "cashier",
  "wechat_barcode",
  "alipay_barcode",
]);

/**
 * 归一化 pay_type：
 * 兼容旧版数字配置（1=支付宝，2=微信，3=QQ 钱包）→ 映射到新版 API 字符串值；
 * 其它非法值兜底为 native（微信 NATIVE 扫码）。
 */
export function getXorpayPayType(): string {
  const v = XORPAY_PAY_TYPE.trim().toLowerCase();
  if (v === "1") return "alipay";
  if (v === "2" || v === "3") return "native";
  if (VALID_PAY_TYPES.has(v)) return v;
  return "native";
}

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
}): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!XORPAY_AID) {
    return { ok: false, error: "XORPAY_AID is not configured" };
  }

  const body = new URLSearchParams({
    order_id: fields.order_id,
    name: fields.name,
    price: fields.price,
    pay_type: fields.pay_type,
    notify_url: fields.notify_url,
    sign: fields.sign,
    sign_type: "MD5",
  }).toString();

  try {
    const res = await fetch(`https://xorpay.com/api/pay/${XORPAY_AID}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `XorPay responded with unexpected status ${res.status}: ${text}` };
    }

    // 防御性解析：XorPay 可能返回非 JSON（如 HTML 错误页），此时捕获原始文本便于排查。
    let data: { status?: number | string; [k: string]: unknown };
    try {
      data = (await res.json()) as { status?: number | string; [k: string]: unknown };
    } catch {
      const text = await res.text();
      return {
        ok: false,
        error: `XorPay returned a non-JSON response: ${text.slice(0, 300)}`,
      };
    }

    // XorPay 以 status === "ok" 表示下单成功（旧文档为 1，兼容两者）；
    // 其它值为错误码（sign_error / fee_error / aid_not_exist / pay_type_error …）
    const ok = data?.status === "ok" || data?.status === 1 || data?.status === "1";
    if (!ok) {
      const status = data?.status ?? "unknown";
      const msg = data?.msg || data?.message || "";
      return { ok: false, error: `XorPay order failed (${status}) ${msg}`.trim() };
    }
    return { ok, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "XorPay request failed",
    };
  }
}
