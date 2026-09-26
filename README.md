# 艾比世界 (AIABW)

**艾比世界** 是一个集 **AI 宠物对话**、**宠物探索冒险**、**动物百科知识** 于一体的 Web 应用。领养你的专属 AI 宠物，陪它聊天、看它出门探索寄回明信片与礼物、在探索中解锁真实的动物百科知识。

- 生产环境：<https://www.aiabw.com>（Vercel 项目名 `aiabw`）
- 技术栈：**Next.js 15 (App Router, Turbopack) · React 19 · TypeScript · TailwindCSS · PostgreSQL (Neon Serverless) · OpenAI/DeepSeek API（OpenAI 兼容协议）**

---

## 核心功能模块

| 模块 | 入口 / 路由 | 状态 | 说明 |
|---|---|---|---|
| AI 宠物聊天 | `/chat` · `POST /api/chat` | ✅ 已上线 | 多步 Agent（天气/计算/搜索 3 个工具），流式回复；10 句免费后需解锁 |
| 探索（每日随机事件） | `POST /api/exploration/start` | ✅ 已上线 | 事件库按权重抽取（postcard/gift/knowledge/encounter/rest），免费 1 次/天，VIP 3 次/天且步数 ×1.5 |
| 动物百科 | `GET /api/animal-wiki/[id]` | ✅ 已上线 | 数据驱动：`animal_wiki` 表每物种一行，知识类探索事件自动关联百科卡片 |
| 百科手账 | `/handbooks` · `POST /api/generate/handbook` | ✅ 已上线 | AI 生成宠物手账，后台任务轮询 |
| 商城 / 装扮 | `/marketplace` · `/api/shop/*` | ✅ 已上线 | 积分购买装扮、装备到宠物 |
| VIP 订阅 | `/api/subscription/*` | ✅ 已上线 | 每日聊天配额：免费 10 条/天，VIP 无限 + 长期记忆 |
| 支付解锁 | `/api/pay/*`（XorPay 码支付） | ✅ 已上线 | 微信/支付宝扫码，异步 notify 回调解锁 |
| 宠物市场（UGC） | `/api/creator/*` | ✅ 已上线 | 创作者发布自定义人设宠物，购买者分成 |
| 盲盒 / 合成 / 繁殖 | `/api/blindbox/*` · `/api/pets/synthesize` | ✅ 已上线 | 抽宠、多宠合成、繁殖进化 |
| 每日签到 / 积分 | `/api/user/checkin` · `/api/points-log` | ✅ 已上线 | 签到 +10 积分，积分可兑换宠物 |

---

## 本地开发

### 1. 环境要求

- Node.js 20+
- 一个 Neon PostgreSQL 数据库（免费层即可）
- 一个 LLM API Key（OpenAI 官方 / DeepSeek / 任意 OpenAI 兼容端点）

### 2. 配置 `.env.local`

Next.js 加载优先级 `.env.local` > `.env`，**`.env.local` 不会被 git 提交**（Vercel 生产环境需在后台单独配置同名变量）。最小可用配置：

```bash
# ══ AI 聊天模型（必填，三选一；按 OPENAI → DEEPSEEK → BAILIAN 优先级生效）══
OPENAI_API_KEY=sk-xxxxxxxx          # API Key（必填）
OPENAI_BASE_URL=https://api.deepseek.com   # OpenAI 兼容端点；不设默认 https://api.openai.com
OPENAI_MODEL=deepseek-chat          # 模型名；不设默认 gpt-4o-mini

# ══ 数据库（必填）══
DATABASE_URL=postgresql://user:pass@host-pooler.aws.neon.tech/db?sslmode=require

# ══ 其他（按需）══
AUTH_SECRET=...        # JWT 签名密钥，生产必须
XORPAY_AID / XORPAY_SECRET / XORPAY_NOTIFY_URL   # 支付（不配置则支付不可用，不影响聊天）
```

> `OPENAI_BASE_URL` 的作用：把请求指向任意 **OpenAI 兼容** 服务（DeepSeek、火山方舟、百炼兼容模式等）；`OPENAI_MODEL` 必须与该端点支持的模型名一致。三者由 `src/lib/get-model.ts` 单点读取，全站 6 处 AI 调用统一生效。

### 3. 启动

```bash
npm install
npm run dev        # http://localhost:3000（Turbopack）
```

首次访问会自动建表（幂等 DDL + 种子数据，见 `src/db/client.ts` 的 `ensureDbSchemaOnce`）。

### 4. 常用命令

```bash
npm test           # node:test 源码协议回归测试（200+ 用例）
npx tsc --noEmit   # 类型检查
npx next build     # 生产构建
```

---

## Vercel 生产部署

1. Git push 到 main → Vercel 自动构建（`next build`）。
2. **首次部署或更换 Key 后**，到 Vercel → Project `aiabw` → Settings → Environment Variables（Production）确认以下变量，然后 **Redeploy**（环境变量修改后必须重新部署才生效）：

| 变量 | 必需 | 说明 |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | 聊天模型 Key（未配置会回退 DEEPSEEK_* → BAILIAN_*） |
| `OPENAI_BASE_URL` | ✅* | 用兼容端点时必填，如 `https://api.deepseek.com` |
| `OPENAI_MODEL` | ✅* | 如 `deepseek-chat` |
| `DATABASE_URL` | ✅ | Neon 连接串（带 `-pooler` 主机） |
| `AUTH_SECRET` | ✅ | JWT 密钥 |
| `XORPAY_AID` / `XORPAY_SECRET` / `XORPAY_NOTIFY_URL` / `XORPAY_PAY_TYPE` / `XORPAY_PRODUCT_NAME` | 支付功能 | 码支付 |
| `CRON_SECRET` | 定时任务 | 守护 `/api/cron/*` |

> **手机端微信支付（/subscribe）**：微信已全面禁用「长按识别二维码」，站点按 UA 自动分流——
> 微信内置浏览器走 JSAPI 直接拉起收银台（自动经 `/api/subscription/wechat-oauth` 完成 OAuth 取 openid），
> 外部浏览器保持 Native 扫码（二维码下方有「扫一扫」引导，5 分钟自动重刷）。
> 前置条件：**XorPay 后台需把站点域名（如 `www.aiabw.com`）加入「支付授权域名」白名单**，否则微信内 JSAPI 拉起会失败。
| `BLOB_READ_WRITE_TOKEN` / `BLOB_STORE_ID` | 图片存储 | Vercel Blob |

---

## 核心文件结构

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts            # AI 聊天主路由（streamText + 工具 + 配额/记忆/解锁校验）
│   │   ├── exploration/             # 探索 V2：start / history / quota
│   │   ├── animal-wiki/[id]/        # 动物百科卡片（公共接口）
│   │   ├── pets/                    # 领养 claim / 图鉴 catalog / 合成 / 进化 / 繁殖
│   │   ├── shop|subscription|pay/   # 商城、VIP 订阅、XorPay 支付
│   │   └── auth/                    # 注册 / 登录 / 游客数据迁移
│   ├── chat/                        # 聊天页（?thread=X&adopt=Y）
│   └── [locale]/                    # next-intl 国际化路由（zh / en）
├── components/
│   ├── chat/chat-panel.tsx          # useChat 封装：Bearer token、配额弹窗、错误兜底展示
│   └── ...                          # shadcn/ui、探索面板、支付弹窗等
├── db/
│   ├── client.ts                    # ★ Neon 连接池（含 error 防护）+ ensureDbSchemaOnce
│   │                                #   幂等建表/补列/索引 + 种子数据（百科、探索事件库）
│   └── schema.ts                    # drizzle-orm 表定义
├── lib/
│   ├── get-model.ts                 # ★ LLM 单点配置（OPENAI→DEEPSEEK→BAILIAN 回退）
│   ├── agent-tools.ts               # get_weather / calculator / web_search
│   ├── exploration-engine.ts        # 探索抽取/步数/百科快照（纯函数）
│   ├── memory*.ts                   # 长期记忆（VIP）
│   └── auth.ts                      # JWT + getUserFromRequest
├── i18n/                            # API 错误文案
└── messages/                        # zh.json / en.json UI 文案
tests/                               # node:test 源码协议回归测试
scripts/                             # 运维/验收脚本（含 debug-chat-e2e.cjs 聊天全链路自检）
```

---

## 常见问题排查（Troubleshooting）

### ① 「AI 完全无回复」且 Network 请求失败（连接被拒绝）

**根因**：Neon pooler 会断开空闲连接，`pg Pool` 触发 `error` 事件时若无监听器，Node 将其作为 `uncaughtException` **杀死整个进程**（历史日志：`scripts/tmp-server.err.log` 的 `Unhandled error` → 进程退出）。

**修复**（已落地于 `src/db/client.ts`）：`pool.on("error", ...)` 挂监听器吞掉空闲连接错误，坏连接自动丢弃、下次查询重建；`connectionTimeoutMillis` 放宽到 15s（Neon 免费层休眠唤醒 >5s，可用 `DB_CONNECTION_TIMEOUT_MS` 覆盖）。

### ② 「AI 无回复」但页面无任何提示

**根因**：`/api/chat` 的 500 返回 HTML 错误页 / 流式错误只有 `"An error occurred."`，前端 `useChat` 拿到非 JSON 错误会静默吞掉。

**修复**（已落地）：路由顶层 try/catch 返回 JSON `{code:"CHAT_INTERNAL_ERROR"}`；`toUIMessageStreamResponse({ onError })` 透出真实错误；`chat-panel.tsx` 对未识别错误显示红色错误条（可重试）。

### ③ 401「请先登录」/ 自动跳登录页

`/api/chat` 强制 `Authorization: Bearer <token>`（token 在 localStorage `aiabw_token`）。`chat-panel.tsx` 的 transport 已动态携带；若 token 过期会自动清除并跳转登录页（带回跳参数）。**自检**：`node scripts/debug-chat-e2e.cjs prepare && node scripts/debug-chat-e2e.cjs chat`（注册→领养→发消息→打印 AI 回复）。

### ④ Neon 冷启动慢（首个请求 10-30s）

免费层自动休眠，唤醒期间首个请求需跑幂等 DDL（快速路径仍执行 CREATE IF NOT EXISTS）。正常现象，随后请求恢复毫秒级；生产建议开启 Neon 始终活跃或接受冷启动。

### ⑤ 模型 401 / 无额度

按优先级检查生效的是哪家（OPENAI→DEEPSEEK→BAILIAN），用 `curl $OPENAI_BASE_URL/chat/completions` 带 Key 直连验证；`.env` 与 `.env.local` 同名变量不一致时 **`.env.local` 优先**。

---

## License

Private / 内部项目。
