# 生产部署检查清单（Phase 10 · Vercel + Neon）

> 上线前逐项打勾。配套文档：`VERCEL_DEPLOY.md`（操作步骤）、`.env.production.example`（环境变量模板）。
> 迁移脚本：`scripts/db-migrate-prod.mjs`（幂等，可重复执行）。

## 0. 上线状态总表（Phase 13 · 2026-09-30 标记）

| # | 检查项 | 状态 | 落点 / 说明 |
| --- | --- | --- | --- |
| 1 | 数据库迁移 v6→v10 执行成功 | ⬜ 待手动操作 | §1；含 Phase 11 `stripe_orders`（SCHEMA_VERSION=10） |
| 2 | 种子数据导入（物种/卡包/道具） | ⬜ 待手动操作 | §2；随迁移自动落库 31 行，接口抽查验证 |
| 3 | 管理员账号创建 | ⬜ 待手动操作 | §3 `scripts/add-admin.cjs` |
| 4 | 环境变量配置（.env.production） | ⬜ 待手动操作 | §4 + `.env.production.example` |
| 5 | 域名绑定（aiabw.com + www） | ⬜ 待手动操作 | §5 + `docs/domain-setup.md` §1-§5 |
| 6 | HTTPS 证书自动签发 | ⬜ 待手动操作 | §6；DNS 生效后 Vercel 自动签发，验证命令见 `docs/domain-setup.md` §6 |
| 7 | 完整用户流程测试（注册→充值→买包→开包→背包→互动） | 🔜 待冒烟验证 | `scripts/smoke-production.mjs` 42 项（dev 已演练 42/42） |
| 8 | 后台管理功能测试 | 🔜 待冒烟验证 | §3：`/admin/*` 登录后手工核对（自动化冒烟不覆盖管理端） |
| 9 | Stripe 支付通道测试 | 🔜 待配置密钥后验证 | `docs/stripe-integration.md` §7 三步走 + 测试卡 4242 |
| 10 | 错误监控配置 | ⬜ 待手动操作 | §7 日志关键词 + Vercel 通知 + resource-check 周检 |
| 11 | 数据库备份策略 | ⬜ 待手动操作 | §8 Neon 备份分支 + pg_dump 异地 |
| 12 | 回滚方案文档 | ✅ 已完成 | `VERCEL_DEPLOY.md` §4 + `docs/rollback.md`（Phase 13） |

## 1. 数据库迁移（v6 → v10）

- [ ] Neon 项目已创建，连接串使用 **-pooler** 主机（Serverless 连接池模式）
- [ ] 本地执行迁移（DATABASE_URL 指向生产库）：

  ```powershell
  $env:DATABASE_URL="postgresql://...pooler..."; node --experimental-loader ./tests/_paths-loader.mjs scripts/db-migrate-prod.mjs
  ```

- [ ] 输出包含 `[db] schema synced to version 10`（首次同步时由 client.ts 打印）
- [ ] 脚本退出码 0，校验全绿：`_schema_meta` version=10、14 张艾比表（含 v10 `stripe_orders`）、`aibi_token_seq` 序列、v9 成长/定价列、目录种子计数
- [ ] 兜底确认：即使跳过本步，生产冷启动也会经版本闸门自动同步一次（Vercel Logs 搜 `[db] schema synced`）；脚本方式可让迁移先于流量发生，推荐执行

## 2. 种子数据

- [ ] v8 目录种子随全量同步自动落库（幂等 upsert，可重导）：稀有度 ×5、栖息地 ×5、物种 ×12、卡包 ×4、道具 ×5（共 31 行）
- [ ] 旧版种子（百科/探索事件 evt-001~060/成就等）由同一版本闸门同步，无需手工导入
- [ ] 抽查接口：`GET /api/aibi/list` = 12 物种；`GET /api/pack/list` = 4 卡包；`GET /api/item/list` = 5 道具

## 3. 管理员账号

- [ ] 首个管理员：`node scripts/add-admin.cjs <邮箱> <密码(≥6位)>`（脚本读 `.env` 的 DATABASE_URL；对生产库执行时临时将生产串放入 `.env` 或改写为环境变量传入，执行后立即还原）
- [ ] 管理端入口 `/admin/*`（dashboard/economy/news/pets/settings/users），登录后核对 `users.role='admin'`
- [ ] 普通运营账号与管理员账号分离；管理员密码独立高强度，不复用任何其他系统密码
- [ ] 如启用 Cron Jobs：`CRON_SECRET` 已配置且未泄露

## 4. 环境变量

- [ ] 对照 `.env.production.example` 逐项配置（Vercel → Settings → Environment Variables → Production）
- [ ] **前缀红线确认**：`DATABASE_URL` / `AUTH_SECRET`（即 JWT_SECRET）/ `CHAIN_DEPLOYER_KEY` 均**不带 `NEXT_PUBLIC_` 前缀**（带前缀会被内联进浏览器 bundle = 泄露）
- [ ] `AUTH_SECRET` 为 ≥32 字节随机值（**不是**开发默认值 `dev-insecure-change-me`）
- [ ] 全表唯一允许 `NEXT_PUBLIC_` 前缀的：`NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL`，值 = 正式域名
- [ ] AI key 仅保留一个有效项（推荐 `DEEPSEEK_API_KEY`）；已删除失效 key，避免静默回退到坏 key（参考 ops-rules 历史教训）
- [ ] `CHAIN_PROVIDER=mock`（上线默认）；切真实链属于后续专项，届时再配 RPC/私钥/合约地址三件套
- [ ] 销毁守卫 `AIBI_BURN_COOLDOWN_HOURS=0` / `AIBI_BURN_REFUND_POINTS=0`（关闭，数值待产品决策）
- [ ] 任何环境变量变更后 **Redeploy** 才生效

## 5. 域名

- [ ] Vercel → Settings → Domains 添加正式域名（主域 = `www.aiabw.com`，裸域 308 → www；详细步骤见 `docs/domain-setup.md`）
- [ ] DNS 按 Vercel 指引配置（`www`：CNAME `cname-china.vercel-dns.com`；apex：A `76.227.212.86`；未备案域名改用全球端点 `cname.vercel-dns.com` / `76.76.21.21`，以 Dashboard 显示为准）
- [ ] `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` 与最终域名一致（影响 sitemap/OG/canonical）
- [ ] 支付回调 `XORPAY_NOTIFY_URL`（如启用）指向正式域名且为 https

## 6. HTTPS

- [ ] Vercel 自动签发 Let's Encrypt 证书，域名状态 Ready（证书自动续期，无需人工；验证命令见 `docs/domain-setup.md` §6）
- [ ] 全站仅 https 可访问（Vercel 默认 http→https 308）
- [ ] 页面无混合内容（自有素材均为相对路径/Blob https）

## 7. 日志

- [ ] Vercel → Logs/Monitoring 可检索；关注关键词：`[db]`、`[aibi-api]`、`[pay/`、`[agent-`、`ERROR`、`Function timed out`
- [ ] 首次部署后的冷启动日志中 `[db] schema synced to version 10` 只出现一次（版本闸门幂等）；若反复出现 = 同步失败重试，需排查
- [ ] Neon Console → Monitoring：存储/计算时长/连接数正常，`scripts/check-resources.js` 可出报告
- [ ] 5xx 告警通道可用（Vercel 通知或每周 resource-check 工作流）

## 8. 备份

- [ ] **迁移前**：Neon 创建备份分支（Console → Branches → Create branch，copy-on-write 秒级）作为回滚快照点
- [ ] 关键表知晓：`users` / `aibi_tokens` / `mint_logs` / `burn_logs` / `user_items` / `points_log`（资产与流水，丢失不可重建）
- [ ] 可选：首次上线后 `pg_dump` 逻辑备份一份异地保存；后续纳入每周巡检（`.github/workflows/resource-check.yml` 已在跑用量）

## 9. 回滚

- [ ] **代码回滚**：Vercel → Deployments → 选中上一可用版本 → ⋯ → Promote to Production（秒级回滚）
- [ ] **数据库回滚兼容性**：v6→v9 全部为「只增不减」幂等 DDL（新建表/列、IF NOT EXISTS），旧代码可在新库上运行 → 代码回滚**不需要**回滚数据库
- [ ] 极端情况需回到迁移前：从第 8 条的备份分支恢复（Neon Branch restore / 切换连接串），操作前先公告停写
- [ ] 回滚后按本清单第 2/7 条重新验证（接口抽查 + 日志无异常）

---

_创建：2026-09-30 · Phase 10。完成全部勾选即具备上线条件。_
