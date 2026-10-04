# Stripe 支付接入文档（艾比平台 Phase 11）

> ## ⏸️ 集成状态：暂缓（Deferred · 2026-10-04 标记）
>
> - **当前状态**：test 模式就绪（2026-10-04 端到端验证通过：create-checkout 真实 Session → 4242 沙盒支付 → webhook 履约落库 +1000 积分 → 真实事件重放 `duplicate` 幂等，全链路绿），**生产环境（live 收款）暂缓**。
> - **阻塞原因**：缺海外运营主体，无法开通 Stripe live 账户。
> - **启用条件**：获得香港/新加坡主体后，替换 5 个环境变量即可启用（`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID_{POINTS,PACK,ITEM}` 全部换成 live 值 → Vercel Redeploy；live 端点需在 Dashboard live 模式另行创建并取其 signing secret；代码零变更）。
> - **当前降级行为**：未配置 live 密钥时优雅返回 `503 PAYMENT_NOT_CONFIGURED`（前端支付按钮降级提示，全站其余功能零影响；冒烟 step 40-41 锁定该语义）。

> 适用：艾比商业化收款 —— 积分充值 / 卡包购买 / 道具购买（面向海外支付）。
> 国内支付（支付宝/微信/聚合）本期仅占位，见 §9。
> 代码：`src/app/api/stripe/*` + `src/lib/stripe{,-config,-service}.ts` + `stripe_orders` 表（drizzle/0028，SCHEMA_VERSION=10）。

---

## 1. 架构概览

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| 下单 | `POST /api/stripe/create-checkout` | 鉴权 + 商品校验 → 创建 Checkout Session → 落库 `stripe_orders(pending)` → 返回支付页 URL |
| 履约 | `POST /api/stripe/webhook` | 验签 → `checkout.session.completed` 事务化回写：积分 / 订单状态 / 背包道具 |
| 配置 | `src/lib/stripe-config.ts` | 商品类型、Price 环境变量映射、积分兑换比、回跳 URL（纯函数单一数据源） |
| 客户端 | `src/lib/stripe.ts` | Stripe SDK 懒加载单例（未配置返回 null，路由降级 503/500 不崩溃） |
| 履约核心 | `src/lib/stripe-service.ts` | 行锁 + status 守卫的恰好一次权益发放；expired 关单 |
| 国内占位 | `/api/payment/domestic` | 501 DOMESTIC_PAYMENT_PENDING（接口位预留，资质确定后扩展） |

**核心原则：权益发放只发生在 Webhook 履约事务内**（客户端跳转 success_url 不做任何入账，
页面刷新/伪造跳转无法获得权益）。

## 2. 支付流程图

```
用户浏览器                Next.js 服务端                      Stripe                Neon DB
    │  POST /api/stripe/create-checkout                    │                     │
    │  {type, packId?, itemId?, quantity}                  │                     │
    │ ─────────────────▶ 1. Bearer 鉴权 401                 │                     │
    │                      2. zod 校验 400                  │                     │
    │                      3. 商品存在性 404                │                     │
    │                      4. checkout.sessions.create ───▶ │                     │
    │                      5. INSERT stripe_orders ─────────────────────────────▶ │ pending
    │ ◀───────────────── { url, sessionId }                │                     │
    │  302 跳转 Stripe Checkout 支付页                      │                     │
    │ ────────────────────────────────────────────────▶    │ 用户付款（测试卡 4242）│
    │                                                      │ webhook POST        │
    │                        /api/stripe/webhook ◀──────── │ checkout.session.   │
    │                        6. 验签(whsec) 400/500 ──────▶│   completed         │
    │                        7. BEGIN; SELECT…FOR UPDATE;  │                     │
    │                           status='pending' 守卫;      │                     │
    │                           UPDATE paid + 发权益 ──────────────────────────▶  │ paid
    │                        COMMIT ── 200 {fulfilled} ──▶ │                     │
    │  success_url 回跳 /{locale}/profile?payment=success ◀ │                     │
    │ ─────────────────▶ 用户中心可见积分/背包变化            │                     │
```

时序要点：下单落库（步骤 5）先于用户支付；webhook（步骤 6-7）是唯一履约入口；
重复投递 / 页面重复回跳均不会重复入账（幂等设计见 §8）。

## 3. 环境变量清单

| 变量 | 用途 | 获取位置 | 备注 |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe API 私钥 | Dashboard → Developers → API keys → Secret key | `sk_test_…` 测试 / `sk_live_…` 生产 |
| `STRIPE_WEBHOOK_SECRET` | Webhook 签名密钥 | Dashboard → Developers → Webhooks → 端点详情 → Signing secret | `whsec_…`；本地用 `stripe listen` 输出 |
| `STRIPE_PRICE_ID_POINTS` | 积分充值 Price | Dashboard → Product catalog | `price_…`，一次性付款 Price |
| `STRIPE_PRICE_ID_PACK` | 卡包购买 Price | 同上 | 同上 |
| `STRIPE_PRICE_ID_ITEM` | 道具购买 Price | 同上 | 同上 |

> ⚠️ 五项全部**仅服务端读取**，绝不加 `NEXT_PUBLIC_` 前缀（会内联进浏览器 bundle 导致密钥泄露）。
> 未配置时行为：`create-checkout` → 503 PAYMENT_NOT_CONFIGURED；`webhook` → 500（Stripe 按重试策略重发）。
> 站点其余功能（聊天/艾比/探索）完全不受影响。

业务常量（代码内单一数据源 `stripe-config.ts`，非环境变量）：
`STRIPE_POINTS_PER_UNIT = 1000`（积分充值每个购买单位到账积分）、
回跳地址 `/{locale}/profile?payment=success|canceled&session_id={CHECKOUT_SESSION_ID}`。

---

## 4. Stripe Dashboard 配置步骤

1. **创建账号 / 切换模式**：<https://dashboard.stripe.com> 注册；右上角切换 **Test mode**（联调）/ 关闭（生产）。
2. **取 API 私钥**：Developers → API keys → 复制 **Secret key** → 配为 `STRIPE_SECRET_KEY`。
3. **建 3 个商品与价格**：Product catalog → **Add product** ×3：
   | Product 建议名 | 对应 Price ID 环境变量 | Price 类型 |
   | --- | --- | --- |
   | Aibi Points ×1000 | `STRIPE_PRICE_ID_POINTS` | One-time |
   | Aibi Card Pack | `STRIPE_PRICE_ID_PACK` | One-time |
   | Aibi Item | `STRIPE_PRICE_ID_ITEM` | One-time |
   每个 Product 建好后进入详情页复制 **Price ID**（`price_…`）。
   > 本期一类商品一个默认 Price（卡包/道具不同定价的按「最高价统一价」或后续迭代扩展
   > per-product Price 映射）；购买数量经 `quantity` 传给 Stripe，金额 = Price × quantity。
4. **配置 Webhook 端点**：Developers → Webhooks → **Add endpoint**：
   - **Endpoint URL**：`https://<你的域名>/api/stripe/webhook`（生产 `https://www.aiabw.com/api/stripe/webhook`）
   - **Events to send**：`checkout.session.completed`、`checkout.session.expired`
   - 创建后进入端点详情 → **Signing secret** → 复制 `whsec_…` → 配为 `STRIPE_WEBHOOK_SECRET`。
5. **Vercel 配环境变量**：Project → Settings → Environment Variables 按 §3 表录入 5 项
   （Production 勾选；Preview 用 test 系密钥按需勾选），重新部署生效。

## 5. Webhook 端点语义

**URL**：`POST /api/stripe/webhook`（服务端对服务端，无用户鉴权——`stripe-signature` 头验签即鉴权）。

| 情形 | HTTP | 含义 / Stripe 行为 |
| --- | --- | --- |
| 验签通过 + 履约成功 | 200 `{received, outcome:"fulfilled", balance?}` | 完结 |
| 验签通过 + 重复事件 | 200 `{outcome:"duplicate"}` | 幂等确认，不再发权益 |
| 验签通过 + 本地无此订单 | 200 `{outcome:"unmatched"}` | 如 `stripe trigger` 演示事件，确认收到不重试 |
| `payment_status != "paid"` | 200 `{awaitingPayment:true}` | 延迟到账方式，等 Stripe 后续 paid 事件 |
| `checkout.session.expired` | 200 `{expired:true}` | 待支付单关闭（pending→expired） |
| 其它事件类型 | 200 `{ignored:"<type>"}` | 明确忽略 |
| 签名缺失/验签失败 | 400 `SIGNATURE_INVALID` | Stripe 按重试策略重发（最多 3 天） |
| 密钥未配置 / 履约异常 | 500 | 事务已回滚，Stripe 重发可完整重放 |

> 验签必须使用**原始请求体**（路由内 `req.text()`，绝不先 `JSON.parse`）。

## 6. 本地开发与联调（Stripe CLI）

```bash
# 0) 安装并登录 CLI：https://docs.stripe.com/stripe-cli
stripe login

# 1) 本地 .env.local 配 test 密钥（SK + 3 个 test Price ID）
# 2) 转发 webhook 到本地（终端会输出新的 whsec_…，填入 STRIPE_WEBHOOK_SECRET）
stripe listen --forward-to localhost:3000/api/stripe/webhook

# 3) 触发演示事件（注意：假 session 在本地无订单，预期返回 unmatched —— 属正常）
stripe trigger checkout.session.completed
```

**真实端到端**（推荐）：登录测试账号 → `POST /api/stripe/create-checkout` 拿 `url` →
浏览器打开用测试卡付款 → CLI `stripe listen` 终端应看到 `checkout.session.completed [200]`，
数据库 `stripe_orders.status=paid`、积分/背包到账。

| 测试卡号 | 场景 |
| --- | --- |
| `4242 4242 4242 4242` | 支付成功（任意未来有效期 + 任意 3 位 CVC + 任意邮编） |
| `4000 0000 0000 0002` | 卡被拒绝（checkout 页内失败，不产生 completed 事件） |
| `4000 0025 0000 3155` | 需要 3DS 验证 |

## 7. 冒烟验证步骤

```bash
# A. 契约测试（无需密钥，18 项）
node --experimental-loader ./tests/_paths-loader.mjs --test tests/stripe.test.mjs
npm test   # 全量

# B. 前端冒烟（dev 服务器 :3000；step 21 覆盖降级路径 401/400/503 + webhook 非 2xx + 国内 501）
SMOKE_BASE=http://localhost:3000 node scripts/smoke-aibi-frontend.mjs

# C. 手动 curl（需先登录拿 token；无密钥时预期 503）
curl -X POST http://localhost:3000/api/stripe/create-checkout \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"type":"points","quantity":1}'
curl -X POST http://localhost:3000/api/stripe/webhook -d '{}'        # 预期 400/500
curl -X POST http://localhost:3000/api/payment/domestic -d '{}'      # 预期 501
```

## 8. 履约与幂等设计（恰好一次）

1. `stripe_orders.id` = Checkout Session ID（`cs_…`），天然幂等键；下单 `ON CONFLICT DO NOTHING`。
2. 履约事务：`BEGIN` → `SELECT … FOR UPDATE` 行锁 → `status='pending'` 守卫
   （`paid` → duplicate 早退；`expired` → not_pending）→ `UPDATE status='paid'` +
   权益写入（积分 `users.points + points_log('stripe_recharge')`；卡包 `user_items 'pack:<id>' source='stripe_pack'`；
   道具 `user_items <id> source='stripe_item'`）→ `COMMIT`。
3. 任一步失败 `ROLLBACK` 并返回 500 → Stripe 重发后完整重放，无中间态。
4. `points_amount` 下单时快照落库，履约不重算（防 `STRIPE_POINTS_PER_UNIT` 日后调整造成漂移）。
5. `amount_total` / `currency` webhook 回填（分 / 币种），供对账。

## 9. 国内支付占位

- `ANY /api/payment/domestic` → **501 DOMESTIC_PAYMENT_PENDING**（details 含
  `plannedProviders: ["alipay","wechat_pay","aggregate"]`）。
- 决策待定：主体资质（ICP 备案 / 商户号）明确后，在「支付宝+微信官方直连」与「合规聚合支付」间选型，
  届时在本路由下扩展 `/create` `/notify` 子路径，对外契约与本占位保持一致。
- 边界说明：站内既有 XorPay（`/api/pay/*`）仅服务宠物位解锁/订阅/装扮老链路，
  与艾比 `stripe_orders` 履约流互不耦合。

## 10. 故障排查

| 症状 | 排查 |
| --- | --- |
| create-checkout 503 | `STRIPE_SECRET_KEY` / 对应 `STRIPE_PRICE_ID_*` 是否配置并重新部署 |
| webhook 一直 400 | `STRIPE_WEBHOOK_SECRET` 是否为该端点的 Signing secret（test/live 别混用） |
| webhook 一直 500 | 服务端日志 `[aibi-api]` / `[stripe]`；确认环境变量后等 Stripe 自动重试 |
| Dashboard 显示 unmatched | 该 session 非本站下单（如 CLI trigger 演示事件），属预期 |
| 支付成功但无权益 | Dashboard → Webhooks → 端点 → Attempts 看投递状态；可手动 Resend 重放 |
| 收不到 webhook | 端点 URL 是否公网可达；Vercel 防火墙/地域拦截；CLI 本地联调用 `stripe listen` |

