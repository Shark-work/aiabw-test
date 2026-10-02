# Backlog（待办池）

> 健康检查已评估但暂不执行的事项，供后续会话拾取。完成后删除对应条目。
> 创建于 2026-09-30（批 A/B/C 已上线，以下均为暂缓项）。

## ~~P2 · 手账生成兜底 cron 未调度~~ ✅ 已解决（2026-09-30）

- 方案落地：新增 GitHub Actions 工作流 `.github/workflows/handbook-cron.yml`，每天 UTC 04:30 调用 `GET /api/cron/process-handbooks` 兜底（复用 CRON_SECRET 鉴权约定，与 agent-daily.yml 同模式）。
- 前提：GitHub 仓库 Secrets 需配置 `CRON_SECRET`（与 Vercel 环境变量同值），否则工作流打印 SKIP 不执行。

## P2 · B4 /api/gallery 与 B6 agent 系 API 用量核查（需 Vercel Dashboard）

- **目标**：评估 `/api/gallery` 与 `/api/agent-*` 系路由的调用频率/耗时，判断是否需要缓存或限流。
- **阻塞**：本机 `.env.local` / `.env` 均无 `VERCEL_TOKEN`，无法 API 拉取日志；需用户到 Vercel Dashboard → 项目 → Logs 人工核查（搜 `[gallery]`、`[agent-`），或提供 VERCEL_TOKEN 后用 `scripts/check-resources.js`。
- **现状**：两系路由均在线上正常运行（冒烟 42/42 覆盖），暂无报错迹象，属容量规划而非故障。

## P3 · blindbox 与 /pets/[id] 页面级 openGraph 缺分享图（批 B 同型，按约束未动）

- **背景**：Next.js 对 `openGraph` 浅合并——页面 `generateMetadata` 导出 openGraph 后，layout 的 `siteName/locale` 与 `opengraph-image` 约定文件注入的 `images` 整体丢失。批 B 已用 `ogShareFields()` 修复 7 页（packs/soul-cards/codex/shop/supply/aibi详情/news）。
- **遗留**：`blindbox/page.tsx`（L40）与 `pets/[id]/page.tsx`（L45）同型问题，因「/pets、/my-pets、/blindbox 不动」约束未修 → 这两页分享卡片无 og:image、无 site_name。
- **处置**：约束解除后各加一行 `...ogShareFields(locale)` 即可（helper 已在 `src/lib/site.ts`）。

## P3 · B1 / B2 / B3：breed / transfer / referral API 入口决策（待产品侧确认优先级）

- **B1** breed（繁育）：代码库无 `/api/breed` 路由（2026-09-30 全仓核实），可能为规划中功能或链上操作；入口形态与配额策略待产品确认后再实现。
- **B2** transfer（转赠）：代码库无 `/api/transfer` 路由（同上核实）；入口与费用/冷却策略待产品确认。
- **B3** `POST /api/referral`（邀请返利）：路由存在，入口与奖励规则待产品确认。
- 用户决策（2026-09-30）：三项整体暂缓，**待产品侧确认优先级**后单独排期；期间不自动删除、不改动现有行为。

---

_关联：批 A `97e1ad3`、批 B `65cc4b1`+`583ebfc`、批 C `4e1a84e` 均已上线（build ✓ / 445 测试 ✓ / 冒烟 42/42 ✓ / Xorpay 双探活 ✓）。_
