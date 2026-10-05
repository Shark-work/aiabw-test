# 艾比世界代码库结构图（Phase 0 交付）

> 生成：2026-10-05 · 基线 commit `931fac1` · SCHEMA_VERSION 18 · 测试 576/576
> 本文档是《产品升级实施计划》Phase 0 的完成标志，后续 Phase 执行前必读。

---

## 1. 真实目录结构（与计划文档假设的差异见 §4）

```
src/
├── app/
│   ├── [locale]/                # next-intl 双语路由（zh/en），30+ 页面
│   │   ├── page.tsx             # 首页
│   │   ├── chat/ explore-v2/ explore/（308 重定向）
│   │   ├── soul-cards/[id]/（+ /public 公开页）
│   │   ├── marketplace/ blindbox/ packs/ bag/ shop/
│   │   ├── pets/[id]/ pets/my/ my-pets/  codex/ news/[id]/ handbooks/ memories/
│   │   ├── postcard-wall/[userId]/ threads/[id]/  workshop/（diary-card / portrait）
│   │   ├── aibi/[tokenId]/ supply/
│   │   ├── onboarding/ login/ register/ subscribe/ settings/ profile/ points/
│   │   └── about/ faq/ contact/ legal/{terms,privacy,virtual-goods}
│   ├── api/                     # 100+ 路由，核心域：
│   │   ├── auth/{login,register,me,migrate}     # JWT 认证 + 游客迁移
│   │   ├── chat/（+ quota）                     # AI 聊天（Agent+流式+配额）
│   │   ├── pay/{create,notify} payment/domestic # XorPay 码支付
│   │   ├── subscription/（+ wechat-oauth/callback, cancel, status, plans）
│   │   ├── stripe/{create-checkout,webhook}     # 海外支付
│   │   ├── exploration/{start,quota,history,postcard-wall}
│   │   ├── pets/（claim/catalog/breed/transfer/synthesize/evolve/release/[id]/interact…）
│   │   ├── soul-cards/[id]/（story/burn/share.png）
│   │   ├── aibi/（mint/burn/fuse/list/owner/profile/spotlight/supply/token）
│   │   ├── user/{checkin,profile,items/equip} points-log/ points/redeem-pet/
│   │   ├── achievements/ leaderboard/ gallery/ memories/ bag/
│   │   ├── blindbox/draw gacha/draw pack/{buy,list,open} item/{buy,list}
│   │   ├── creator/{apply,pets,publish,upload} ugc/generate-portrait
│   │   ├── generate/handbook/[taskId] cron/{process-handbooks,push-recall}
│   │   ├── push/{config,subscribe,unsubscribe} news/ seasonal-events/active
│   │   └── admin/{users,pets,news,settings,stats} visits/ keepalive/
│   └── sitemap.ts robots.ts manifest.ts       # SEO/PWA
├── components/                  # chat/ layout/ subscription/ collection/ …（shadcn 风格）
├── db/
│   ├── client.ts                # ★ Neon Pool + ensureDbSchemaOnce 版本闸门（v18）
│   │                            #   幂等 DDL + 种子数据（百科/探索事件/AIBI 目录…）
│   └── schema.ts                # ★ drizzle-orm 表定义（40+ 表，单文件）
├── lib/
│   ├── auth.ts                  # scrypt(v2$,N=8192) 密码哈希 + jose HS256 JWT(30d)
│   ├── xorpay.ts                # ★ 支付封装：MD5 签名/下单/JSAPI UA 分流/OAuth openid
│   ├── get-model.ts             # LLM 单点配置（DEEPSEEK→OPENAI→BAILIAN 回退）
│   ├── agent-tools.ts           # 天气/计算/搜索 3 工具
│   ├── exploration-engine.ts    # 探索抽取纯函数（evt-001~060）
│   ├── achievements-*.ts        # 8 徽章评估器 + 事务化解锁
│   ├── points-recharge.ts       # 积分档位表（服务端定价唯一来源）
│   ├── checkin-makeup.ts        # 补签订单号/价格常量
│   ├── blindbox-draw.ts         # 盲盒抽取执行器（notify 回调复用）
│   ├── premium.ts               # 高级公民定价
│   ├── genetics.ts              # NFR 繁育（BREED_COST=200，亲本 7 天冷却）
│   └── memory*.ts soul-card-service.ts …
├── i18n/                        # API 错误文案（api-errors.ts）
└── messages/zh.json en.json     # UI 文案（next-intl）
drizzle/                         # drizzle-kit 生成的 SQL 快照（0000~0033）
tests/                           # 52 个 node:test 文件，576 用例（源码协议回归风格）
scripts/                         # 运维：db-migrate-prod.mjs（★生产迁移）、check-resources.js…
docs/                            # 本文件、LAUNCH_ANNOUNCEMENT、aibi-transformation-spec…
```

## 2. 核心流程说明

### 2.1 认证流（src/lib/auth.ts + /api/auth/*）

```
注册/登录 → scrypt(v2$, N=8192, salt16:hash64) 存 users.password_hash
         → jose SignJWT(HS256, sub=user.id, 30d) → 前端存 localStorage aiabw_token
API 鉴权 → getUserFromRequest(req) 解 Authorization: Bearer → AuthUser{id,email}
游客   → adoptions.user_id='anonymous' 先玩 → /api/auth/migrate 登录后迁移
```

### 2.2 支付流（src/lib/xorpay.ts + /api/pay/*）

```
下单 POST /api/pay/create {kind}
  kind ∈ unlock|cosmetic|premium|blindbox|points|checkin_makeup
  （subscription 走 /api/subscription/create，Stripe 走 /api/stripe/*）
  → 服务端定价唯一来源：档位表/常量（绝不信任前端金额）
  → MD5 签名 name+pay_type+price+order_id+notify_url+secret
  → POST xorpay.com/api/pay/{aid} → 返回 qr（native）或 JSAPI 参数（微信内 UA 分流）
回调 POST /api/pay/notify（form-urlencoded）
  → 验签 md5(aoid+order_id+pay_price+pay_time+secret)
  → 按 order_id 前缀正则路由到各业务入账（unlock-/cosmetic-/premium-/subscription-/
    blindbox-/points-/checkin-makeup-）
  → 幂等（唯一约束/条件更新），正文回 "success" 停止重试
```

### 2.3 Schema 版本闸门（src/db/client.ts）

```
ensureDbSchemaOnce：冷启动首个 DB 调用时
  → 读 _schema_meta.version；< SCHEMA_VERSION(18) 则顺序执行幂等 DDL+种子
  → 版本号 bump 的部署后，必须本地手动跑：
      node --experimental-loader ./tests/_paths-loader.mjs scripts/db-migrate-prod.mjs

## 3. Phase 0 验收记录

| 验收项 | 结果 |
|---|---|
| 开发服务器正常启动无报错 | ✅ Ready in 2.5s；GET /zh 200；GET /api/seasonal-events/active 200 |
| 576 个测试用例全部通过 | ✅ tests 576 / pass 576 / fail 0（4.3s） |
| 环境变量配置 | ✅ `.env`（DB/AI/XorPay/Blob/社媒）+ `.env.local`（链上/Stripe/模型覆盖），双文件加载正常 |
| 理解核心流程 | ✅ §2（认证/支付/版本闸门/AI 链） |

## 4. ⚠️ 计划文档 vs 实际代码库差异对照（后续 Phase 以此为准）

| 计划文档假设 | 实际代码库 | 处置 |
|---|---|---|
| `src/schemas/` 目录 | Schema 在 **`src/db/schema.ts` 单文件** | Phase 1 改这里 |
| `src/lib/payment/` 目录 | 支付封装在 **`src/lib/xorpay.ts`**（+ stripe 在路由内） | 扩展商品改 pay/create + xorpay.ts |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | 代码读 **`AUTH_SECRET`**；TTL 硬编码 30d | 不新增 JWT_SECRET |
| `XORPAY_API_KEY` / `XORPAY_MERCHANT_ID` | 实为 **`XORPAY_AID` / `XORPAY_SECRET`**（兼容读 XORPAY_APP_SECRET） | 沿用现有名 |
| `/api/pay/webhook` | 实为 **`/api/pay/notify`**（XorPay form 回调） | 增强 notify |
| `npm run db:migrate` 初始化 | drizzle-kit migrate 存在但**生产权威机制是 ensureDbSchemaOnce + scripts/db-migrate-prod.mjs** | Phase 1 双轨改 |
| 积分余额「全局 header」 | header 组件在 src/components/layout/ | Phase 4 落地 |
| 错误码 40001~50003 数字制 | 现有为字符串 code + apiError(locale, key) 双语 | **沿用现有风格**，不引入数字码 |
| pets 表无养成字段 | **adoptions 已有 level/chat_count/monthly_points**（drizzle/0004）；pets 表字段 Phase 1 核实后幂等加列 | IF NOT EXISTS |

## 5. 安全红线（沿用 CHECKLIST.md / ops-rules）

- `DATABASE_URL` / `AUTH_SECRET` / `CHAIN_DEPLOYER_KEY` 绝不带 `NEXT_PUBLIC_` 前缀
- 支付金额只信服务端常量（points-recharge.ts / premium.ts / checkin-makeup.ts）
- 积分入账幂等：`points_log.ref` 唯一索引
- 含 SCHEMA_VERSION bump 的部署 → 必须手动跑 db-migrate-prod.mjs 再 smoke

    （冷启动全量同步 ~60s 超 hobby maxDuration 会死锁 version=-1，见 ops-rules）
drizzle/00xx.sql：drizzle-kit generate 的快照，与 client.ts 幂等 DDL 双轨并行
```

### 2.4 AI 调用链（src/lib/get-model.ts）

```
6 处 AI 调用统一走 getModel()：DEEPSEEK_* → OPENAI_* → BAILIAN_* 回退
聊天 /api/chat：streamText + 3 工具，免费 10 句/天（chat quota），VIP 无限+长期记忆
```
