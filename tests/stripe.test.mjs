// 艾比平台 Phase 11 · Stripe 支付通道接入 契约测试（2026-10-01）
// 覆盖：
//  1) stripe-config 纯函数：商品类型 / Price 环境变量映射 / 积分兑换比 / 回跳 URL 构建
//  2) create-checkout 路由：鉴权 / zod 三类型 / 未配置 503 降级 / Session 创建 + 订单落库
//  3) webhook 路由：原始体验签 / 400·500 语义 / completed+expired 分支
//  4) stripe-service 履约：行锁幂等 / 积分·卡包·道具三类权益 / 事务边界
//  5) 国内支付占位路由 / 错误码双语 / DB 契约（0028 + SCHEMA_VERSION=10）/ 环境与文档
// 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/stripe.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  STRIPE_PRODUCT_TYPES,
  isStripeProductType,
  STRIPE_PRICE_ENV,
  STRIPE_POINTS_PER_UNIT,
  STRIPE_WEBHOOK_PATH,
  CHECKOUT_SESSION_PLACEHOLDER,
  resolvePriceId,
  buildCheckoutReturnUrls,
  stripeSecretKey,
  stripeWebhookSecret,
} from "../src/lib/stripe-config.ts";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const exists = (rel) => existsSync(join(ROOT, rel));

// === 1) stripe-config 纯函数 ===
test("config: 三种商品类型 points/pack/item + 类型守卫", () => {
  assert.deepEqual([...STRIPE_PRODUCT_TYPES], ["points", "pack", "item"]);
  for (const t of STRIPE_PRODUCT_TYPES) assert.ok(isStripeProductType(t));
  for (const bad of ["coupon", "", "POINTS", null, undefined, 1]) {
    assert.equal(isStripeProductType(bad), false, `reject ${String(bad)}`);
  }
});

test("config: Price 环境变量映射 = 需求清单三项，全部服务端专用（无 NEXT_PUBLIC_）", () => {
  assert.equal(STRIPE_PRICE_ENV.points, "STRIPE_PRICE_ID_POINTS");
  assert.equal(STRIPE_PRICE_ENV.pack, "STRIPE_PRICE_ID_PACK");
  assert.equal(STRIPE_PRICE_ENV.item, "STRIPE_PRICE_ID_ITEM");
  for (const name of Object.values(STRIPE_PRICE_ENV)) {
    assert.ok(!name.startsWith("NEXT_PUBLIC_"), `${name} must be server-only`);
  }
});

test("config: resolvePriceId 注入 env 解析（空白→null，值去空格）", () => {
  const env = { STRIPE_PRICE_ID_POINTS: "  price_123  ", STRIPE_PRICE_ID_PACK: "" };
  assert.equal(resolvePriceId("points", env), "price_123");
  assert.equal(resolvePriceId("pack", env), null);
  assert.equal(resolvePriceId("item", env), null);
});

test("config: 积分兑换比 / webhook 路径 / 密钥读取器形态", () => {
  assert.ok(Number.isInteger(STRIPE_POINTS_PER_UNIT) && STRIPE_POINTS_PER_UNIT >= 100);
  assert.equal(STRIPE_WEBHOOK_PATH, "/api/stripe/webhook");
  // 未配置环境下返回 null 而非抛异常（路由降级的前提）
  assert.equal(stripeSecretKey(), process.env.STRIPE_SECRET_KEY?.trim() || null);
  assert.equal(stripeWebhookSecret(), process.env.STRIPE_WEBHOOK_SECRET?.trim() || null);
});

test("config: 回跳 URL — locale 归一 + session 占位符原样保留 + origin 去尾斜杠", () => {
  const zh = buildCheckoutReturnUrls("https://www.aiabw.com/", "zh");
  assert.equal(
    zh.successUrl,
    `https://www.aiabw.com/zh/profile?payment=success&session_id=${CHECKOUT_SESSION_PLACEHOLDER}`,
  );
  assert.equal(zh.cancelUrl, "https://www.aiabw.com/zh/profile?payment=canceled");
  const en = buildCheckoutReturnUrls("http://localhost:3000", "en");
  assert.ok(en.successUrl.startsWith("http://localhost:3000/en/profile?payment=success"));
  // 非法 locale 回退 zh（防开放路径注入）
  const fallback = buildCheckoutReturnUrls("https://x.com", "fr/../../evil");
  assert.ok(fallback.successUrl.startsWith("https://x.com/zh/profile"));
  assert.ok(CHECKOUT_SESSION_PLACEHOLDER.includes("CHECKOUT_SESSION_ID"));
});

// === 2) create-checkout 路由契约 ===
test("create-checkout: 鉴权 401 + zod 三类型枚举 + 参数先校验后通道", () => {
  const src = read("src/app/api/stripe/create-checkout/route.ts");
  assert.match(src, /getUserFromRequest\(req\)/);
  assert.match(src, /aibiFail\("UNAUTHORIZED", 401, req\)/);
  assert.match(src, /z\.enum\(\["points",\s*"pack",\s*"item"\]\)/);
  assert.match(src, /quantity:\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(99\)/);
  // 顺序契约：parseBody 必须先于 getStripe 降级（非法入参恒 400）
  assert.ok(
    src.indexOf("parseBody(req, bodySchema)") < src.indexOf("getStripe()"),
    "parseBody must run before stripe-client check (400 before 503)",
  );
});

test("create-checkout: 未配置降级 503 + 商品存在性校验 + 积分快照", () => {
  const src = read("src/app/api/stripe/create-checkout/route.ts");
  assert.match(src, /aibiFail\("PAYMENT_NOT_CONFIGURED", 503, req\)/);
  assert.match(src, /aibi_packs WHERE id = \$1 AND status = 'active'/);
  assert.match(src, /aibi_items WHERE id = \$1/);
  assert.match(src, /PACK_NOT_FOUND", 404/);
  assert.match(src, /ITEM_NOT_FOUND", 404/);
  assert.match(src, /body\.quantity \* STRIPE_POINTS_PER_UNIT/);
});

test("create-checkout: Session 创建携带履约 metadata + 订单落库 + 返回 URL", () => {
  const src = read("src/app/api/stripe/create-checkout/route.ts");
  assert.match(src, /stripe\.checkout\.sessions\.create\(\{/);
  assert.match(src, /mode:\s*"payment"/);
  assert.match(src, /line_items:\s*\[\{ price: priceId, quantity: body\.quantity \}\]/);
  assert.match(src, /success_url: successUrl/);
  assert.match(src, /cancel_url: cancelUrl/);
  assert.match(src, /client_reference_id: user\.id/);
  assert.match(src, /metadata:\s*\{[\s\S]+?userId: user\.id[\s\S]+?type: body\.type[\s\S]+?pointsAmount/);
  assert.match(src, /createStripeOrder\(pool, \{/);
  assert.match(src, /aibiOk\(\{ url: session\.url, sessionId: session\.id/);
});

// === 3) webhook 路由契约 ===
test("webhook: 原始体验签（req.text 先解析禁 JSON）+ 400/500 语义", () => {
  const src = read("src/app/api/stripe/webhook/route.ts");
  assert.match(src, /req\.headers\.get\("stripe-signature"\)/);
  assert.match(src, /await req\.text\(\)/);
  assert.ok(!src.includes("req.json()"), "webhook 绝不用 req.json()（破坏验签）");
  assert.match(src, /constructWebhookEvent\(rawBody, signature, webhookSecret\)/);
  assert.match(src, /aibiFail\("SIGNATURE_INVALID", 400, req\)/);
  // 密钥未配置 → 500（非 2xx，Stripe 会重试）
  assert.match(src, /aibiFail\("PAYMENT_NOT_CONFIGURED", 500, req\)/);
});

test("webhook: completed → 履约；未 paid 不履约；expired → 关单；其它事件 ignored", () => {
  const src = read("src/app/api/stripe/webhook/route.ts");
  assert.match(src, /event\.type === "checkout\.session\.completed"/);
  assert.match(src, /session\.payment_status !== "paid"[\s\S]+?awaitingPayment: true/);
  assert.match(src, /fulfillStripeCheckout\(pool, session\)/);
  assert.match(src, /event\.type === "checkout\.session\.expired"/);
  assert.match(src, /expireStripeCheckout\(pool, session\.id\)/);
  assert.match(src, /ignored: event\.type/);
});

// === 4) stripe-service 履约契约 ===
test("service: 行锁 + status 守卫 + duplicate 早退（恰好一次履约）", () => {
  const src = read("src/lib/stripe-service.ts");
  assert.match(src, /FROM stripe_orders WHERE id = \$1 FOR UPDATE/);
  assert.match(src, /order\.status === "paid"[\s\S]+?outcome: "duplicate"/);
  assert.match(src, /outcome: "unmatched"/);
  assert.match(src, /UPDATE stripe_orders SET status = 'paid', paid_at = now\(\), amount_total = \$2, currency = \$3/);
  assert.match(src, /BEGIN/);
  assert.match(src, /COMMIT/);
  assert.match(src, /ROLLBACK/);
});

test("service: 三类权益发放 —— 积分回写 / 卡包入包 / 道具入包", () => {
  const src = read("src/lib/stripe-service.ts");
  assert.match(src, /UPDATE users SET points = points \+ \$1 WHERE id = \$2::uuid RETURNING points/);
  assert.match(src, /INSERT INTO points_log \(user_id, amount, reason\) VALUES \(\$1::uuid, \$2, 'stripe_recharge'\)/);
  assert.match(src, /'pack:' \|\| \$2, 'common', 'stripe_pack' FROM generate_series\(1, \$3\)/);
  assert.match(src, /\$2, 'common', 'stripe_item' FROM generate_series\(1, \$3\)/);
  // 落库幂等：session id 主键冲突忽略
  assert.match(src, /INSERT INTO stripe_orders[\s\S]+?ON CONFLICT \(id\) DO NOTHING/);
});

test("client: stripe 懒加载单例 + 未配置返回 null + 验签异常吞掉转 null", () => {
  const src = read("src/lib/stripe.ts");
  assert.match(src, /import Stripe from "stripe"/);
  assert.match(src, /new Stripe\(key\)/);
  assert.match(src, /cached = key \? new Stripe\(key\) : null/);
  assert.match(src, /stripe\.webhooks\.constructEvent\(rawBody, signature, webhookSecret\)/);
  assert.match(src, /catch \(err\)/);
});

// === 5) 国内支付占位 / 错误码 / DB / 环境 / 文档 ===
test("domestic: 占位路由 GET+POST 均 501 + 规划三渠道 + 不接真实 SDK", () => {
  const src = read("src/app/api/payment/domestic/route.ts");
  assert.match(src, /export async function POST/);
  assert.match(src, /export async function GET/);
  assert.match(src, /aibiFail\("DOMESTIC_PAYMENT_PENDING", 501, req, PLACEHOLDER_DETAILS\)/);
  assert.match(src, /plannedProviders: \["alipay", "wechat_pay", "aggregate"\]/);
  assert.ok(!/from "stripe"/.test(src) && !/alipay-sdk|wechatpay/.test(src), "占位路由不接任何真实支付 SDK");
});

test("errors: aibi-api 三新码中英双语", () => {
  const src = read("src/lib/aibi-api.ts");
  for (const code of ["PAYMENT_NOT_CONFIGURED", "SIGNATURE_INVALID", "DOMESTIC_PAYMENT_PENDING"]) {
    const re = new RegExp(`${code}: \\{ zh: "[^"]+", en: "[^"]+" \\}`);
    assert.match(src, re, `${code} bilingual message`);
  }
});

test("db: drizzle/0028 + client.ts DDL/索引 + SCHEMA_VERSION>=10 + schema 导出", () => {
  assert.ok(exists("drizzle/0028_stripe_orders.sql"), "migration file exists");
  const mig = read("drizzle/0028_stripe_orders.sql");
  assert.match(mig, /CREATE TABLE IF NOT EXISTS "stripe_orders"/);
  assert.match(mig, /回滚/);
  const client = read("src/db/client.ts");
  assert.ok(client.includes('CREATE TABLE IF NOT EXISTS "stripe_orders"'), "DDL in SCHEMA_CREATES");
  assert.ok(client.includes('CREATE INDEX IF NOT EXISTS "idx_stripe_orders_user"'), "index in SCHEMA_INDEXES");
  const v = Number(client.match(/SCHEMA_VERSION\s*=\s*(\d+)/)?.[1]);
  assert.ok(v >= 10, `SCHEMA_VERSION 需 >=10（实际 ${v}），否则生产库不同步 stripe_orders`);
  const schema = read("src/db/schema.ts");
  assert.match(schema, /export const stripeOrders = pgTable\('stripe_orders'/);
});

test("env: 模板含 5 个 STRIPE_ 变量且全部无 NEXT_PUBLIC_ 前缀", () => {
  const env = read(".env.production.example");
  for (const name of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_ID_POINTS",
    "STRIPE_PRICE_ID_PACK",
    "STRIPE_PRICE_ID_ITEM",
  ]) {
    assert.ok(env.includes(name), `.env.production.example missing ${name}`);
  }
  assert.ok(!/NEXT_PUBLIC_STRIPE/.test(env), "Stripe 变量绝不允许 NEXT_PUBLIC_ 前缀");
});

test("package/docs: stripe 依赖 + 集成文档关键章节", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies?.stripe, "stripe in dependencies");
  assert.ok(exists("docs/stripe-integration.md"), "docs/stripe-integration.md exists");
  const doc = read("docs/stripe-integration.md");
  for (const anchor of [
    "/api/stripe/webhook",
    "checkout.session.completed",
    "4242",
    "stripe listen",
    "STRIPE_PRICE_ID_POINTS",
    "STRIPE_WEBHOOK_SECRET",
  ]) {
    assert.ok(doc.includes(anchor), `doc missing anchor: ${anchor}`);
  }
});
