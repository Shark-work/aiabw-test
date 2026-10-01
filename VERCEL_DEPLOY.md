# Vercel 生产部署指南（Phase 10）

> 目标：把 `aiabw`（Next.js 15 App Router + Neon Postgres）从 GitHub 部署到 Vercel 生产环境。
> 上线检查项见 `CHECKLIST.md`；环境变量模板见 `.env.production.example`。

## 0. 前置准备

| 项 | 说明 |
| --- | --- |
| GitHub 仓库 | 代码已推送（含 `pnpm-lock.yaml`；Vercel 检测到 pnpm lockfile 自动用 pnpm 安装） |
| Neon 项目 | Serverless Postgres，复制 **-pooler** 连接串作为 `DATABASE_URL` |
| Vercel 账号 | 与 GitHub 授权互通（Hobby 免费层即可起步） |
| AI key | 一个有效的 `DEEPSEEK_API_KEY`（聊天/推荐依赖） |

## 1. 从 GitHub 导入

1. Vercel Dashboard → **Add New… → Project** → **Import Git Repository** 选择本仓库。
2. Framework Preset 自动识别 **Next.js**，保持默认：
   - Build Command：`next build`（即 `npm run build`）
   - Install Command：自动 = `pnpm install --frozen-lockfile`
   - Output / Node 版本保持默认（Node 20+）。
3. 先**不要**点 Deploy —— 进入第 2 步配置环境变量（也可直接 Deploy 后补配再 Redeploy）。

## 2. 配置环境变量

Settings → **Environment Variables**，按下表添加（Environment 勾选 **Production**）：

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Neon **-pooler** 连接串（服务端专用，**无 NEXT_PUBLIC_ 前缀**） |
| `AUTH_SECRET` | ✅ | JWT 签名密钥（即需求所称 JWT_SECRET；代码读取名 = `AUTH_SECRET`），≥32 字节随机串（**无 NEXT_PUBLIC_ 前缀**） |
| `DEEPSEEK_API_KEY` | ✅ | AI 对话；仅保留一个有效 key |
| `NEXT_PUBLIC_SITE_URL` | ✅ | 正式域名 `https://…`（SEO/sitemap/OG） |
| `NEXT_PUBLIC_APP_URL` | ✅ | 同上值（需求清单命名；前端可见） |
| `CHAIN_PROVIDER` | ✅ | 上线固定 `mock`（链下模拟账本） |
| `CHAIN_RPC_URL` | evm 时 | EVM RPC 端点；mock 模式留空 |
| `CHAIN_DEPLOYER_KEY` | evm 时 | 热钱包私钥（服务端专用，**无 NEXT_PUBLIC_ 前缀**，绝不入仓库） |
| `AIBI_BURN_COOLDOWN_HOURS` | ✅ | 销毁冷静期（小时），上线初 `0` = 关闭 |
| `AIBI_BURN_REFUND_POINTS` | ✅ | 销毁返还积分，上线初 `0` = 关闭 |
| `CRON_SECRET` | 按需 | 启用 Vercel Cron 时必填 |
| `XORPAY_*` | 按需 | 码支付五件套；不配则支付不可用，不影响其他功能 |

> ⚠️ 前缀红线：`DATABASE_URL` / `AUTH_SECRET`(JWT_SECRET) / `CHAIN_DEPLOYER_KEY` 三者必须**不带** `NEXT_PUBLIC_` 前缀——带前缀的变量会被内联进浏览器 bundle，等于公开泄露。

## 3. 首次部署

1. **Deploy**。构建约 2–4 分钟（186 页静态生成）。
2. 部署成功后，**先迁库再放量**——本地执行（推荐，迁移先于流量）：

   ```powershell
   # PowerShell（Windows 注意：在仓库根目录、盘符大写路径下执行）
   $env:DATABASE_URL="postgresql://…-pooler…"; node --experimental-loader ./tests/_paths-loader.mjs scripts/db-migrate-prod.mjs
   ```

   期待输出：`[db] schema synced to version 10` + 全部 ✅，退出码 0。
   （脚本幂等；若跳过本步，首个冷启动实例也会自动同步一次，Vercel Logs 搜 `[db] schema synced` 确认。）
3. **验收**（本地跑，打生产）：

   ```powershell
   $env:SMOKE_BASE="https://<你的域名>"; node scripts/smoke-aibi-frontend.mjs
   ```

   42/42 通过即上线成功（Phase 5-11 全链路）。手工抽查：`/zh`（首页艾比区块）、`/zh/codex`、`/zh/supply`、注册→买包→开包全流程。
4. 绑定正式域名：按 **§6** 执行（细节见 `docs/domain-setup.md`），更新 `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` 后 **Redeploy**。

## 4. 回滚方式

| 场景 | 操作 |
| --- | --- |
| **代码回滚（秒级）** | Deployments → 上一可用版本 → ⋯ → **Promote to Production** |
| **环境变量回滚** | Settings → Environment Variables 改回旧值 → Deployments → 当前版本 **Redeploy**（env 变更必须重新部署才生效） |
| **数据库回滚** | 通常**不需要**：v6→v9 全部是只增不减的幂等 DDL，旧代码兼容新库。极端情况用迁移前创建的 Neon 备份分支恢复（先停写公告），详见 CHECKLIST 第 8/9 条 |

## 5. 部署后运维

- 日志：Vercel → Logs，关注 `[db]` / `[aibi-api]` / `[pay/` / `ERROR` / `Function timed out`。
- 用量：`node scripts/check-resources.js`（Vercel ≥70%、Neon ≥300MB 告警）；每周一自动巡检 workflow 超阈值自动开 Issue。
- 冷启动：`[db] schema synced to version 10` 全生命周期只应出现一次；反复出现 = 同步失败，按 CHECKLIST 第 7 条排查。

## 6. 绑定正式域名（Phase 12）

> 本节为主流程摘要；详细 DNS 配置、Cloudflare 接入、检查清单、HTTPS 验证命令、失败排查：`docs/domain-setup.md`。

**主域 = `https://www.aiabw.com`**（与 `src/lib/site.ts` 的 `SITE_URL` 默认值一致，SEO 输出基准）；裸域仅跳转。

| 域名 | 记录 | 值 |
| --- | --- | --- |
| `www.aiabw.com` | CNAME | `cname-china.vercel-dns.com`（中国优化；**未备案域名**改用全球端点 `cname.vercel-dns.com`） |
| `aiabw.com` | A | `76.227.212.86`（全球端点 `76.76.21.21`）；以 Dashboard Domains 页显示为准 |

1. Vercel → Settings → **Domains**：Add `www.aiabw.com` 与 `aiabw.com`，裸域勾选 **Redirect to www.aiabw.com**。
2. DNS 服务商处按上表配置（NS 在 Cloudflare 则建在 CF；CF 的 SSL/TLS 必须 **Full (Strict)**，代理推荐灰云 DNS only —— 见 domain-setup §4）。
3. DNS 生效后 Vercel 自动签发 Let's Encrypt 证书；两域名均 `Valid Configuration` 后：把 `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` 改为 `https://www.aiabw.com` → **Redeploy**（NEXT_PUBLIC_ 内联进 bundle，必须重新部署）。
4. 联动项：Stripe webhook 端点改为 `https://www.aiabw.com/api/stripe/webhook`（domain-setup §8）；`XORPAY_NOTIFY_URL`（如启用）换 https 正式域名；Stripe 支付回跳按请求 origin 自动跟随，无需配置。
5. 验证：`curl.exe -sI https://www.aiabw.com` → `HTTP/2 200` 且 `server: Vercel`；`http`/裸域入口均 308 → `https://www.aiabw.com`；最后按 §3 第 3 步再跑一次冒烟（`SMOKE_BASE=https://www.aiabw.com`，42/42）。

---

_创建：2026-09-30 · Phase 10；更新：2026-09-30 · Phase 11（验收口径 42/42、schema v10）+ Phase 12（§6 域名绑定章节）。_
