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

## P3 · B1 / B2 / B3：breed / transfer / referral API 入口决策（待产品侧确认优先级）

- **B1** breed（繁育）：代码库无 `/api/breed` 路由（2026-09-30 全仓核实），可能为规划中功能或链上操作；入口形态与配额策略待产品确认后再实现。
- **B2** transfer（转赠）：代码库无 `/api/transfer` 路由（同上核实）；入口与费用/冷却策略待产品确认。
- **B3** `POST /api/referral`（邀请返利）：路由存在，入口与奖励规则待产品确认。
- 用户决策（2026-09-30）：三项整体暂缓，**待产品侧确认优先级**后单独排期；期间不自动删除、不改动现有行为。

---

_关联：批 A `97e1ad3`、批 B `65cc4b1`+`583ebfc`、批 C `4e1a84e`、批 D `13828ef`（handbook cron）+`668a0c6`（OG 补漏）均已上线（build ✓ / 445 测试 ✓ / 冒烟 42/42 ✓ / Xorpay 双探活 ✓）。_
