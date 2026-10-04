# Backlog（待办池）

> 健康检查已评估但暂不执行的事项，供后续会话拾取。完成后删除对应条目。
> 创建于 2026-09-30（批 A/B/C 已上线，以下均为暂缓项）。

## ~~P2 · 手账生成兜底 cron 未调度~~ ✅ 已解决（2026-09-30）

- 方案落地：新增 GitHub Actions 工作流 `.github/workflows/handbook-cron.yml`，每天 UTC 04:30 调用 `GET /api/cron/process-handbooks` 兜底（复用 CRON_SECRET 鉴权约定，与 agent-daily.yml 同模式）。
- 前提：GitHub 仓库 Secrets 需配置 `CRON_SECRET`（与 Vercel 环境变量同值），否则工作流打印 SKIP 不执行。

## ~~P2 · B4 /api/gallery 与 B6 agent 系 API 孤儿核查~~ ✅ 已核查（2026-10-02）

- **核查结论（2026-10-02，4 端点均非孤儿，全部保留）**：
  - `/api/gallery` → **保留**：NFR E2E 调用方（`scripts/verify-nfr.cjs` L197/202 断言持有者 owned 标记）+ 公开图鉴接口（无鉴权 GET 200，数字藏品体系 breed/transfer/gallery 三件套展示面）。
  - `/api/agent/daily-digest` → **保留**：GitHub Actions `agent-daily.yml` 每日 UTC 03:00 POST 调度（CRON_SECRET 鉴权），确定有持续流量。
  - `/api/agent/memories/verify` → **保留**：设计意图即验收自检端点（route 注释自述「验收用」；根目录 `verify-agent.js` 手动 E2E），零业务流量属预期。
  - `/api/agent/post-to-social` → **保留**：手动调试通道（`verify-agent.js` B/C/D 用例；业务发布走 daily-digest 内部库调用 `agent-social.postToSocial`，不经 HTTP），暂不移除。
- **核查手段**：全仓调用方扫描（前端组件/workflows/scripts/.env 模板零遗漏）+ `vercel.json`（无 routes 数组）/ `src/middleware.ts`（matcher 排除 /api）路由注册检查 + 生产探活（gallery 200 在线；agent 三件套 401 鉴权在线）。修正 2026-09-30 初查两处遗漏：gallery 实为 verify-nfr.cjs 调用；post-to-social / memories/verify 实为根目录 verify-agent.js 调用。
- **限制**：本机无 `VERCEL_TOKEN`，未拉 Vercel 访问日志；以上结论基于物理路径 + 静态调用方 + 生产探活三重证据。

## ~~P3 · blindbox 与 /pets/[id] 页面级 openGraph 缺分享图~~ ✅ 已解决（2026-09-30，批 D）

- 两页 `generateMetadata` 的 openGraph 已展开 `...ogShareFields(locale)`（commit `668a0c6`），金丝雀实测 /zh/blindbox 与 /zh/pets/corgi 的 og:image + og:site_name + og:locale 全部注入，物种动态标题不受影响。

## ~~P1 · Aibi 聊天能力（方案 a）~~ ✅ 已完成（2026-10-07，方案 a 正式落地）

- **背景**：`aibi_species.supports_chat` 原为 9/12 物种 true，但全站无任何代码路径消费该字段（2026-10-06 全仓核实），属"能力开关空转"，给用户造成"艾比可聊天"的预期落差。已执行方案 b：种子值全物种置 false（SCHEMA_VERSION 11 同步生产），`aibi.interact.actions.talk` 显示名改为「问候 / Greet」（字段与 actionType 枚举保留）。
- **落地**（commits `3febc28` / `6309e7a` / `305ac59` / `424688f` + 测试 commit）：
  1. `aibi_tokens.thread_id`（uuid，nullable，FK→threads ON DELETE SET NULL；SCHEMA_VERSION 12 同步生产，drizzle/0029 档案 + scripts/migrate-add-aibi-threadid.mjs 幂等补列）；
  2. `/chat` 页宠物源扩展：`petType=aibi:<aibiTokenId>` 编码；adoptions 未命中时按 thread_id 反查 aibi_tokens（仅 minted）；emoji 头像（紫色边框）+「艾比」来源徽章 + affinity→心情条 / growth_level→等级；
  3. prompt 构建：`src/lib/aibi-prompt.ts` 以 personality_template 为种子，注入成长状态（mood/affinity/energy/growth_level）+ 稀有度/元素/栖息地 lore；/api/chat 按主体类型分支（凭证归属 + minted 校验，经典线逻辑零改动）；每日 quota 与 VIP 记忆两条线共用（pet_memories.pet_id 存 `aibi:<tokenId>`）；
  4. 入口：POST /api/threads（zod + 幂等 + 并发守护，不产生孤儿线程）；背包卡片与 /aibi/[tokenId] 详情页 AibiChatButton（有线程直跳 /chat?thread=，无线程「创建聊天」）；/api/bag/aibis 与 token 详情携带 threadId（后者仅持有者下放——threadId 即窥视钥匙）。
- **supports_chat 种子已恢复 true**（全物种，随 v12 同步生产）；契约测试 tests/aibi-chat-e2e.test.mjs（16 项）。

## P2 · 积分/金币双货币统一叙事（2026-10-06 登记，功能融合度诊断 #6）

- **现状**：单一 users.points 贯穿全部业务线（points_log 13 种 reason），但 UI 存在"积分/金币"两套话术混用，schema 注释（"仅用于 UGC 宠物与抽奖"）已过时。
- **方向**：统一术语为一种叫法并全站替换；同步更新 schema.ts 注释与 legal.goodsBody 表述；若未来确需双货币（软/硬通货），再单独设计。
- **预估**：1 天（纯文案 + 注释）。

## P3 · B1 / B2 / B3：breed / transfer / referral API 入口决策（待产品侧确认优先级）

- **B1** breed（繁育）：✅ 已落地（2026-10-08，审计任务 2）——实际路由 `POST /api/pets/breed`（同物种 2 亲本 + 7 天亲本冷却 + 200 积分），入口 = 收藏中心 NFR Tab 卡片「繁育」按钮（配对弹窗 + 冷却倒计时禁用态）。
- **B2** transfer（转赠）：✅ 已落地（2026-10-08，审计任务 2）——实际路由 `POST /api/pets/transfer`（首铸 24h / 再转赠 7 天冷却，一阶段免费），入口 = 收藏中心 NFR Tab 卡片「转赠」按钮（选个体 → 接收方昵称 toUsername → 二次确认；邮箱隐私不对外故不用 email 标识）；同期新增 `GET /api/pets/collectibles` 个体实例端点与 transferSelf 自赠护栏。
- **B3** `POST /api/referral`（邀请返利）：路由存在，入口与奖励规则待产品确认。
- 用户决策（2026-09-30）：三项整体暂缓，**待产品侧确认优先级**后单独排期；期间不自动删除、不改动现有行为。

## P3 · 灵魂名进聊天线（2026-10-09 登记，观察期 1-2 周）

- **背景**：2026-10-09「我的灵宠」体系升级将 `soulName`（元素前缀灵魂名，src/lib/soul-pet.ts）落地图鉴/详情页（读路径派生，DB 零迁移）；聊天线未动（`/api/pets` displayName 与聊天人设注入维持原型名）。
- **决策点**：观察 1-2 周数据（图鉴灵魂名展示后的用户行为/反馈/客服疑问）后决定是否扩展到聊天场景。
- **若推进的触点**：`/api/pets` 的 `displayName` 派生链（aibi-names.ts 内聚门槛）+ `/api/chat` 人设 prompt 注入；需评估对记忆连续性/人设一致性的影响（聊天记录中的名字变更会造成认知断层）。
- **暂缓理由**：聊天是高频核心路径，命名变更影响面大，先用图鉴低频场景验证用户接受度。

---

_关联：批 A `97e1ad3`、批 B `65cc4b1`+`583ebfc`、批 C `4e1a84e`、批 D `13828ef`（handbook cron）+`668a0c6`（OG 补漏）均已上线（build ✓ / 445 测试 ✓ / 冒烟 42/42 ✓ / Xorpay 双探活 ✓）。_
