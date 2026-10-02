# Backlog（待办池）

> 健康检查已评估但暂不执行的事项，供后续会话拾取。完成后删除对应条目。
> 创建于 2026-09-30（批 A/B/C 已上线，以下均为暂缓项）。

## P2 · 手账生成兜底 cron 未调度（B5 查明，待决策）

- **现状**：`POST /api/generate/handbook` 为异步设计——先落 `handbooks(status='processing')` 立即返回，`setTimeout` 后台跑 `runHandbookTask`（原子认领 + 10 分钟卡死自愈）。兜底路由 `GET /api/cron/process-handbooks` 已实现（CRON_SECRET 鉴权、每批 5 条），**但未注册进 `vercel.json` crons**（现有 news/refresh + push-recall 已占满 Vercel Hobby 2 个 cron 名额），仓库内也无 GitHub Actions 等外部触发器。
- **风险**：Vercel serverless 不保证响应后的 fire-and-forget 完成 → 任务可能永久卡 `processing`，手账偶发不生成。
- **处置选项**（三选一，需用户决策）：
  1. GitHub Actions 定时工作流（免费额度内 5-10 分钟一次）打 `Authorization: Bearer $CRON_SECRET /api/cron/process-handbooks`；
  2. 把兜底逻辑合并进现有某个 cron 路由（如 push-recall 顺带跑一批）；
  3. Vercel Pro 后直接在 vercel.json 注册第三个 cron。
- **附**：生产 `handbooks` 状态分布未能核实（本机 .env.local 无 DATABASE_URL），处置前建议先查 stuck 数量。

## P2 · B4 /api/gallery 与 B6 agent 系 API 用量核查（需 Vercel Dashboard）

- **目标**：评估 `/api/gallery` 与 `/api/agent-*` 系路由的调用频率/耗时，判断是否需要缓存或限流。
- **阻塞**：本机 `.env.local` / `.env` 均无 `VERCEL_TOKEN`，无法 API 拉取日志；需用户到 Vercel Dashboard → 项目 → Logs 人工核查（搜 `[gallery]`、`[agent-`），或提供 VERCEL_TOKEN 后用 `scripts/check-resources.js`。
- **现状**：两系路由均在线上正常运行（冒烟 42/42 覆盖），暂无报错迹象，属容量规划而非故障。

## P3 · blindbox 与 /pets/[id] 页面级 openGraph 缺分享图（批 B 同型，按约束未动）

- **背景**：Next.js 对 `openGraph` 浅合并——页面 `generateMetadata` 导出 openGraph 后，layout 的 `siteName/locale` 与 `opengraph-image` 约定文件注入的 `images` 整体丢失。批 B 已用 `ogShareFields()` 修复 7 页（packs/soul-cards/codex/shop/supply/aibi详情/news）。
- **遗留**：`blindbox/page.tsx`（L40）与 `pets/[id]/page.tsx`（L45）同型问题，因「/pets、/my-pets、/blindbox 不动」约束未修 → 这两页分享卡片无 og:image、无 site_name。
- **处置**：约束解除后各加一行 `...ogShareFields(locale)` 即可（helper 已在 `src/lib/site.ts`）。

## P3 · B1 / B2 / B3（沿用健康检查清单编号，整体暂缓）

- 用户决策：三项均暂不处理，具体条目描述见原始健康检查报告（2026-09-30 会话）。
- 拾取时请回查该报告原文，按项评估后单独排期。

---

_关联：批 A `97e1ad3`、批 B `65cc4b1`+`583ebfc`、批 C `4e1a84e` 均已上线（build ✓ / 445 测试 ✓ / 冒烟 42/42 ✓ / Xorpay 双探活 ✓）。_
