/**
 * 艾比平台 Phase 11 · Stripe 支付配置（纯函数 · 零依赖 · 单一数据源）
 *
 * 环境变量（全部【仅服务端读取】，绝不加 NEXT_PUBLIC_ 前缀——前缀会被内联进浏览器 bundle）：
 *   STRIPE_SECRET_KEY        Stripe API 私钥（sk_test_… / sk_live_…）
 *   STRIPE_WEBHOOK_SECRET    Webhook 签名密钥（whsec_…，Dashboard 或 stripe listen 生成）
 *   STRIPE_PRICE_ID_POINTS   积分充值 Price ID（price_…）
 *   STRIPE_PRICE_ID_PACK     卡包购买 Price ID（price_…）
 *   STRIPE_PRICE_ID_ITEM     道具购买 Price ID（price_…）
 *
 * 配置步骤与冒烟验证见 docs/stripe-integration.md。
 */

/** 三种商品类型：积分充值 / 卡包购买 / 道具购买 */
export const STRIPE_PRODUCT_TYPES = ["points", "pack", "item"] as const;
export type StripeProductType = (typeof STRIPE_PRODUCT_TYPES)[number];

export function isStripeProductType(v: unknown): v is StripeProductType {
  return typeof v === "string" && (STRIPE_PRODUCT_TYPES as readonly string[]).includes(v);
}

/** 商品类型 → Price ID 环境变量名（需求清单固定三项：一类商品一个默认 Price） */
export const STRIPE_PRICE_ENV: Record<StripeProductType, string> = {
  points: "STRIPE_PRICE_ID_POINTS",
  pack: "STRIPE_PRICE_ID_PACK",
  item: "STRIPE_PRICE_ID_ITEM",
};

/**
 * 积分充值：每个 Checkout 数量单位到账的积分。
 * 金额（¥/$ 多少）在 Stripe Dashboard 的 Price 上配置，本常量只决定「付一份钱给多少积分」。
 */
export const STRIPE_POINTS_PER_UNIT = 1000;

/** Webhook 端点路径（Dashboard 配置与文档引用同一常量，避免漂移） */
export const STRIPE_WEBHOOK_PATH = "/api/stripe/webhook";

/** Stripe success_url 的会话占位符（Stripe 要求原样保留，支付完成跳转时由其替换） */
export const CHECKOUT_SESSION_PLACEHOLDER = "{CHECKOUT_SESSION_ID}";

const trimOrNull = (v: string | undefined): string | null => {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
};

/** 服务端专用：Stripe API 私钥；未配置返回 null（路由据此优雅降级 503，不抛异常）。 */
export const stripeSecretKey = (): string | null => trimOrNull(process.env.STRIPE_SECRET_KEY);

/** 服务端专用：Webhook 签名密钥；未配置返回 null（webhook 据此返回 500 让 Stripe 重试）。 */
export const stripeWebhookSecret = (): string | null => trimOrNull(process.env.STRIPE_WEBHOOK_SECRET);

/**
 * 按商品类型解析 Price ID；未配置返回 null（路由降级 503 PAYMENT_NOT_CONFIGURED）。
 * 前缀守卫：仅接受 price_ 前缀——2026-10-04 生产事故：三个 Price ID 被误配为
 * Product ID（prod_ 前缀），Stripe API 抛 "No such price" → 下单 500。
 * 非 price_ 值按未配置处理，使误配退化为优雅降级 503 而非内部错误。
 */
export function resolvePriceId(
  type: StripeProductType,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const v = trimOrNull(env[STRIPE_PRICE_ENV[type]]);
  return v && v.startsWith("price_") ? v : null;
}

/**
 * 支付完成 / 取消的回跳地址：
 * 落到已有 /[locale]/profile 用户中心页（支付后立即可见积分与资产变化），
 * 附带 payment=success|canceled 与 session_id 查询参数，供前端后续做结果横幅。
 */
export function buildCheckoutReturnUrls(
  origin: string,
  locale: string,
): { successUrl: string; cancelUrl: string } {
  const loc = locale === "en" ? "en" : "zh";
  const base = `${origin.replace(/\/+$/, "")}/${loc}/profile`;
  return {
    successUrl: `${base}?payment=success&session_id=${CHECKOUT_SESSION_PLACEHOLDER}`,
    cancelUrl: `${base}?payment=canceled`,
  };
}
