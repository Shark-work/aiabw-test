# Backlog（待办池）

> 健康检查已评估但暂不执行的事项，供后续会话拾取。完成后删除对应条目。
> 创建于 2026-09-30（批 A/B/C 已上线，以下均为暂缓项）。

## ~~P2 · 手账生成兜底 cron 未调度~~ ✅ 已解决（2026-09-30）

- 方案落地：新增 GitHub Actions 工作流 `.github/workflows/handbook-cron.yml`，每天 UTC 04:30 调用 `GET /api/cron/process-handbooks` 兜底（复用 CRON_SECRET 鉴权约定，与 agent-daily.yml 同模式）。
- 前提：GitHub 仓库 Secrets 需配置 `CRON_SECRET`（与 Vercel 环境变量同值），否则工作流打印 SKIP 不执行。

## P2 · B4 /api/gallery 与 B6 agent 系 API 孤儿核查（待用户查 Vercel 日志后决策）

- **目标**：确认 `/api/gallery`、`/api/agent/daily-digest`、`/api/agent/post-to-social`、`/api/agent/memories/verify` 最近 30 天是否有外部调用；无调用 → 建议删除，有调用 → 保留并补文档说明调用方。
- **代码侧已知线索（2026-09-30 核实）**：
  - `/api/agent/daily-digest` 有明确外部调用方——GitHub Actions `agent-daily.yml` 每天 UTC 03:00 POST 调用（CRON_SECRET 鉴权）→ **倾向保留**；
  - 其余 3 个（gallery / post-to-social / memories/verify）仓库内无工作流或脚本调用记录，待日志确认。
- **阻塞**：本机无 `VERCEL_TOKEN`，需用户到 Vercel Dashboard → 项目 → Logs 人工核查（详细查询清单见 2026-09-30 会话报告，或提供 VERCEL_TOKEN 后自动化）。
- **约束**：不自动删除任何接口，等用户确认日志结果后再定。
- **现状**：各路由线上运行正常（冒烟 42/42），暂无报错迹象，属去留决策而非故障。

## ~~P3 · blindbox 与 /pets/[id] 页面级 openGraph 缺分享图~~ ✅ 已解决（2026-09-30，批 D）

- 两页 `generateMetadata` 的 openGraph 已展开 `...ogShareFields(locale)`（commit `668a0c6`），金丝雀实测 /zh/blindbox 与 /zh/pets/corgi 的 og:image + og:site_name + og:locale 全部注入，物种动态标题不受影响。

## P3 · B1 / B2 / B3：breed / transfer / referral API 入口决策（待产品侧确认优先级）

- **B1** breed（繁育）：代码库无 `/api/breed` 路由（2026-09-30 全仓核实），可能为规划中功能或链上操作；入口形态与配额策略待产品确认后再实现。
- **B2** transfer（转赠）：代码库无 `/api/transfer` 路由（同上核实）；入口与费用/冷却策略待产品确认。
- **B3** `POST /api/referral`（邀请返利）：路由存在，入口与奖励规则待产品确认。
- 用户决策（2026-09-30）：三项整体暂缓，**待产品侧确认优先级**后单独排期；期间不自动删除、不改动现有行为。

---

_关联：批 A `97e1ad3`、批 B `65cc4b1`+`583ebfc`、批 C `4e1a84e`、批 D `13828ef`（handbook cron）+`668a0c6`（OG 补漏）均已上线（build ✓ / 445 测试 ✓ / 冒烟 42/42 ✓ / Xorpay 双探活 ✓）。_
