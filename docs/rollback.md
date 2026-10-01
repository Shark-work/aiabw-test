# 生产回滚手册（Phase 13 · 2026-09-30）

> 配套：`CHECKLIST.md` §9（回滚检查项）、`VERCEL_DEPLOY.md` §4（回滚一节）、`docs/domain-setup.md`。
> 原则：**先判断要不要动数据库**——v6→v10 全部迁移均为「只增不减」幂等 DDL（新建表/列、IF NOT EXISTS），
> 旧代码可在新库上运行，因此**绝大多数回滚只需要回滚代码/环境变量，不需要回滚数据库**。
> 文中「截图点位」以 ☐ 标注：首次真实演练时按点位补截图存档（本手册以精确的界面路径与预期界面文字替代）。

## 0. 回滚决策表

| 场景 | 手段 | 预计耗时 | 动数据库？ |
| --- | --- | --- | --- |
| 新版本代码 bug / 5xx 激增 | §1 Vercel Promote 上一版本 | < 2 分钟 | 否 |
| 环境变量配错（域名/AI key/CHAIN_*） | §3 改回旧值 + Redeploy | ~5 分钟 | 否 |
| Stripe 密钥泄露 / 误用 live key | §4 轮换密钥 + 更新 Vercel | ~10 分钟 | 否 |
| 支付异常（重复扣款/履约异常） | §5 紧急关闭支付 | ~5 分钟 | 否 |
| 迁移写坏数据（极端，仅 v6→v10 不适用之外的情况） | §2 Neon 时间点恢复 | 15-30 分钟 | **是** |
| 数据库连接串泄露 | §2.4 轮换密码 + 更新 Vercel | ~10 分钟 | 否（改配置） |

---

## 1. Vercel 代码回滚（最常用，秒级）

**适用**：新部署引入 bug、页面白屏、接口 5xx。Vercel 保留全部历史部署，回滚 = 把某个历史部署重新指定为 Production。

1. 打开 Vercel Dashboard → 项目 `aiabw` → 顶部 **Deployments** 标签。
   ☐ 截图点位 1：Deployments 列表，每行含 commit message / 状态 / 部署时间 / 域名。
2. 找到**上一个状态为 Ready 的生产部署**（列表中带 `Production` 徽标的当前版本之下那条；用 commit message 对照 git 历史确认）。
3. 该行右侧 **⋯** 菜单 → **Promote to Production** → 确认弹窗中点 **Promote**。
   ☐ 截图点位 2：⋯ 菜单展开，含 Promote to Production / Redeploy / Inspect Deployment 等项。
4. 等待 ~30 秒，列表中该版本出现 `Production` 徽标 → 回滚完成（新流量即刻走旧版本；构建产物是现成的，无需重新构建）。
5. 验证：`curl.exe -s -o NUL -w "%{http_code}" https://www.aiabw.com/zh` 应 200；再按 §6 跑冒烟。

**注意**：
- Promote **不会**回滚环境变量（变量是当前项目级配置，见 §3）。
- 数据库无需回滚（只增不减 DDL，旧代码兼容新库）。
- 若最新部署尚在 Building/Error 状态，直接 Promote 旧版本即可，无需等它失败完。

---

## 2. 数据库回滚（Neon 时间点恢复）

> **仅当确认数据库内容本身损坏时使用**（如手工 SQL 误删/迁移脚本写脏数据）。
> 代码回滚（§1）永远不需要本步骤。

### 2.1 前置认知

- Neon 免费档时间点恢复窗口默认 **24 小时**（以 Console → 项目 Settings → Storage/Restore 显示为准）；
  超出窗口只能靠手工备份分支（`CHECKLIST.md` §8：每次迁移前必建）或 pg_dump 异地备份。
- 推荐姿势 = **从时间点建恢复分支 → 验证 → 切换连接串**，主分支原样保留，可反复试错。

### 2.2 操作步骤

1. **停写公告**：先 §1 把代码回滚到稳定版（或在 Vercel 暂停部署），避免恢复期间继续写入脏数据。
2. Neon Console（https://console.neon.tech）→ 项目 → 左侧 **Branches** → **Create branch**。
   ☐ 截图点位 3：Create branch 弹窗，含 branch name / parent / **Point in time** 选项。
3. 选择 **Point in time**，把时间戳设为**故障发生之前**（如迁移开始前的备份分支创建时刻），命名 `restore-2026MMDD`，创建（秒级，copy-on-write）。
4. 进入新分支 → **Connection Details** 复制该分支的 **-pooler** 连接串。
   ☐ 截图点位 4：分支详情页 Connection string 下拉，注意选 Pooled connection。
5. **验证恢复分支**（本地，不碰生产）：

   ```powershell
   $env:DATABASE_URL="postgresql://…restore 分支 -pooler…"
   node --experimental-loader ./tests/_paths-loader.mjs scripts/db-migrate-prod.mjs   # 校验版本/表/种子
   ```

   另抽查关键表行数：`users` / `aibi_tokens` / `mint_logs` / `stripe_orders` / `points_log`。
6. **切换流量**：Vercel → Settings → Environment Variables → 把 `DATABASE_URL` 改为恢复分支连接串 → **Deployments → 当前 Production → ⋯ → Redeploy**（环境变量必须 Redeploy 才生效）。
7. 验证通过后：主分支数据已被放弃（可保留观察几天再删）；把恢复分支在 Neon 中 **Set as default**（可选），并重建一个新的备份分支作为下次快照点。

### 2.3 备选：Neon Restore 功能

Console → Branches → 选中分支 → **Restore**（将分支内容回滚到其历史中的某个时间点，会生成 restore 记录）。
适合「主分支自己回滚自己」；与 2.2 的差异是原地回滚而非切换连接串。二选一即可，**2.2 更安全**（先验证再切流）。

### 2.4 连接串泄露处置

Neon Console → 项目 → Settings → **Roles/Reset password** 重置 `neondb_owner` 密码 → 更新 Vercel `DATABASE_URL` → Redeploy；旧连接串即刻失效。

---

## 3. 环境变量回退

**适用**：改错 `NEXT_PUBLIC_SITE_URL` / AI key / `CHAIN_*` / 销毁守卫数值等。

1. 变更前先留底：Vercel → Settings → Environment Variables 页本身不显示明文历史，
   **改任何值之前先把旧值复制到本地密码管理器/加密笔记**（这是唯一的"旧值"来源）。
2. 回退：Settings → Environment Variables → 找到条目 → **⋯ → Edit** → 改回旧值 → Save。
   ☐ 截图点位 5：变量行的 ⋯ 菜单（Edit / Delete / Copy）；注意每行有 Environment 作用域（Production/Preview/Development）。
3. **必须 Redeploy**：Deployments → 当前 Production → ⋯ → **Redeploy**。环境变量在构建/实例启动时注入，不 Redeploy 不生效。
4. 删除敏感变量的场景（如废弃 key）：**⋯ → Delete** → Redeploy；确认无代码路径因缺失而崩溃
   （本项目 AI/Stripe/链层均有降级设计：无 AI key → 聊天降级文案；无 Stripe key → 503 占位；CHAIN_PROVIDER=mock 不依赖外部变量）。

---

## 4. Stripe 密钥轮换

**适用**：Secret Key 疑似泄露（出现在日志/前端 bundle/第三方渠道）、误把 live key 配进预览环境、定期安全轮换。

### 4.1 轮换 Secret Key

1. Stripe Dashboard → **Developers → API keys** → Secret key 行 **⋯ → Roll key…**。
   ☐ 截图点位 6：API keys 页 Standard keys 区，Secret key 行的 Roll key 菜单项。
2. 弹窗选择旧 key 失效时间（泄露场景选 **Immediately / 立即**；计划轮换可选 12h/24h/72h 缓冲）→ **Roll key** 生成新 `sk_live_…`。
3. Vercel → Environment Variables → `STRIPE_SECRET_KEY` 改新值（Production 作用域）→ **Redeploy**。
4. 验证：`SMOKE_BASE=https://www.aiabw.com` 冒烟 step 40（有密钥时应返回真实 `https://checkout.stripe.com/…` URL）。

### 4.2 轮换 Webhook Signing Secret

1. Stripe Dashboard → **Developers → Webhooks** → 点端点 `https://www.aiabw.com/api/stripe/webhook` →
   **Signing secret → Roll secret…**（会同时给出新 `whsec_…`，旧 secret 可设短期并存或直接失效）。
2. Vercel 更新 `STRIPE_WEBHOOK_SECRET` → **Redeploy**。
   ⚠️ 顺序敏感：从 Roll 到 Redeploy 完成之间，webhook 验签失败返回 400——**Stripe 会按重试策略自动重发**，
   短窗口内的事件不会丢；Redeploy 后到 Webhooks 页 **Resend** 补发窗口期事件兜底。
3. 验证：Webhook 详情页 Recent deliveries 出现 200；`stripe_orders` 有 `paid` 行写入（测试卡 4242 走一单）。

### 4.3 泄露后的必查项

- Stripe Dashboard → **Logs**：按时间段排查是否有非本站发起的 API 调用（按 IP/UA 过滤）。
- Webhooks 页是否有**陌生端点**被添加（泄露者常加自己的 webhook 接收付款事件）→ 删除。
- Payments 列表核对异常支付，必要时 Refund + 争议预案。

---

## 5. 紧急关闭支付

**适用**：发现重复扣款、履约逻辑异常、恶意刷单等需要**立即止血**的场景。目标：用户无法再发起新支付，已发生事件不丢。

### 5.1 操作（推荐路径，现有代码已支持）

1. Vercel → Settings → Environment Variables：
   - **Delete** `STRIPE_SECRET_KEY`（Production）；
   - **Delete** `STRIPE_WEBHOOK_SECRET`（Production）。
2. Deployments → 当前 Production → **Redeploy**。
3. 生效后行为（Phase 11 优雅降级，冒烟 step 40-41 已锁定）：
   - `POST /api/stripe/create-checkout` → **503 `PAYMENT_NOT_CONFIGURED`**，前端支付按钮走降级提示，全站其余功能零影响；
   - `POST /api/stripe/webhook` → 500，Stripe 持续重试（恢复配置后补发不会丢事件）；
   - 积分购买恢复为站内积分扣减流程（无外部扣款）。
4. 老 XorPay 通道（如仍配置）：删除 `XORPAY_PID` / `XORPAY_SECRET` / `XORPAY_NOTIFY_URL` 并 Redeploy。

### 5.2 关于 `STRIPE_ENABLED=false` 开关

当前代码**未实现**该开关：删除环境变量与开关等效（两者都需 Redeploy，耗时相同），
且删除变量同时让 webhook 侧进入 500 重试保护。因此本手册以 §5.1 为标准操作；
若未来支付链路变复杂（多通道并存），再评估新增显式开关（记入 backlog）。

### 5.3 恢复支付

重新配置 §4 的两个变量 → Redeploy → Webhooks 页对停用窗口期的事件 **Resend** → 测试卡走一单验证（`docs/stripe-integration.md` §7）。

---

## 6. 回滚后验证（任何回滚动作完成后必做）

1. 冒烟（会留 1 个测试用户及流水，验收性质可接受）：

   ```powershell
   $env:DATABASE_URL="postgresql://…生产-pooler…"; $env:SMOKE_BASE="https://www.aiabw.com"
   node scripts/smoke-production.mjs   # 期望 ALL_SMOKE_OK（42/42）
   ```

   不愿写库时退而求其次：`CHECKLIST.md` §2 接口抽查（`/api/aibi/list` / `/api/pack/list` / `/api/item/list`）。
2. Vercel Logs 关键词检索无新增异常：`ERROR`、`Function timed out`、`[db]`、`[aibi-api]`、`[pay/`。
3. 冷启动日志 `[db] schema synced to version 10` 只出现一次（版本闸门幂等；反复出现 = 同步失败重试，排查 DB 连通性）。
4. Neon Console → Monitoring：连接数/计算时长恢复正常水位。

---

## 7. 演练建议

- 上线后**第一周**内真实演练一次 §1（Promote 回滚再回切）与 §5（关闭/恢复支付），全程计时并补录 ☐ 截图点位。
- 每次数据库迁移前按 `CHECKLIST.md` §8 建备份分支（命名 `backup-<date>-v<N>`），保留至迁移稳定运行 7 天。
- 密钥轮换（§4 / §2.4）建议每季度计划性执行一次，不要等泄露才第一次操作。

---

_创建：2026-09-30 · Phase 13。覆盖：Vercel 代码回滚 / Neon 时间点恢复 / 环境变量回退 / Stripe 密钥轮换 / 紧急关闭支付 / 回滚后验证。_
