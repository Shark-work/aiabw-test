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

## P1 · Aibi 聊天能力（方案 a）待排期（2026-10-06 登记）

- **背景**：`aibi_species.supports_chat` 原为 9/12 物种 true，但全站无任何代码路径消费该字段（2026-10-06 全仓核实），属"能力开关空转"，给用户造成"艾比可聊天"的预期落差。已执行方案 b：种子值全物种置 false（SCHEMA_VERSION 11 同步生产），`aibi.interact.actions.talk` 显示名改为「问候 / Greet」（字段与 actionType 枚举保留）。
- **方案 a（正式打通聊天）三件事**：
  1. `aibi_tokens` 增加 `thread_id` 列（关联 threads，需 schema 迁移 + SCHEMA_VERSION bump）；
  2. `/chat` 页宠物源扩展：当前只读经典线 adoptions，需支持 aibi_tokens 作为会话主体；
  3. prompt 构建：chat 路由按主体类型分支，aibi 使用 `personality_template` + 成长状态（growth_level/affinity/mood）构建系统提示。
- **预估**：3–5 天（含迁移 + 前后端 + 测试）。启用时将 supports_chat 种子值恢复 true 并更新本条目。

## P2 · /my-pets 与 /pets/my 双页合并（2026-10-06 登记，功能融合度诊断 #5）

- **现状**：/my-pets（聊天宠物：心情/记忆/排序搜索）与 /pets/my（宠物图鉴：持有管理/融合/兑换商店）数据源同为 adoptions，职责割裂，用户需在两个"我的宠物"间来回。2026-10-06 已互加跳转条缓解（myPets.evolveBanner ↔ petsCatalog.crossBanner），未治本。
- **合并方向**：以 /pets/my 为主框架并入聊天/心情/记忆能力（或反向），保留双 URL 308 兼容；需梳理 PetDetailModal 与 my-pets 客户端的状态重叠。
- **预估**：2–3 天。合并后撤掉互跳条。

## P2 · 积分/金币双货币统一叙事（2026-10-06 登记，功能融合度诊断 #6）

- **现状**：单一 users.points 贯穿全部业务线（points_log 13 种 reason），但 UI 存在"积分/金币"两套话术混用，schema 注释（"仅用于 UGC 宠物与抽奖"）已过时。
- **方向**：统一术语为一种叫法并全站替换；同步更新 schema.ts 注释与 legal.goodsBody 表述；若未来确需双货币（软/硬通货），再单独设计。
- **预估**：1 天（纯文案 + 注释）。

## P3 · B1 / B2 / B3：breed / transfer / referral API 入口决策（待产品侧确认优先级）

- **B1** breed（繁育）：代码库无 `/api/breed` 路由（2026-09-30 全仓核实），可能为规划中功能或链上操作；入口形态与配额策略待产品确认后再实现。
- **B2** transfer（转赠）：代码库无 `/api/transfer` 路由（同上核实）；入口与费用/冷却策略待产品确认。
- **B3** `POST /api/referral`（邀请返利）：路由存在，入口与奖励规则待产品确认。
- 用户决策（2026-09-30）：三项整体暂缓，**待产品侧确认优先级**后单独排期；期间不自动删除、不改动现有行为。

---

_关联：批 A `97e1ad3`、批 B `65cc4b1`+`583ebfc`、批 C `4e1a84e`、批 D `13828ef`（handbook cron）+`668a0c6`（OG 补漏）均已上线（build ✓ / 445 测试 ✓ / 冒烟 42/42 ✓ / Xorpay 双探活 ✓）。_
