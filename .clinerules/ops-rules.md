# Cline 运维规则：性能 / 卡顿 / 资源问题

> 适用场景：用户询问网站性能、卡顿、变慢、费用增长、资源耗尽、升级建议等。

## 强制检查顺序（不要跳过）

1. **先看数据，再下结论**：
   - 优先检查 **Vercel Logs**（`https://vercel.com/dashboard` → 项目 → Logs / Monitoring / Analytics）：
     - 函数耗时（`functionDuration`）、冷启动（cold start）、报错（5xx、超时）。
   - 优先检查 **Neon 监控**（`https://console.neon.tech` → 项目 → Monitoring / 用量页）：
     - 存储占用（`pg_database_size`）、计算时长（compute time）、连接数、冷唤醒（scale-to-zero）。
   - 可运行 `scripts/check-resources.js` 生成用量报告（需 VERCEL_TOKEN / NEON_API_KEY / DATABASE_URL）。

2. **接近免费额度上限时，先给免费优化方案，再谈升级**：
   - 优先优化（零成本）：
     - 开启 **ISR 缓存**（Next.js `export const revalidate = N` / `fetch(..., { next: { revalidate } })`），缓存高频读页面；
     - **清理历史数据**：Neon 中清理多余分支 / 过期日志（`agent_memories` 有 30 天自动清理）、压缩大字段；
     - 压缩/懒加载图片（public 下有 33MB 的 bg*.png，考虑 WebP/缩放）；
     - 减少不必要的函数调用（客户端缓存、合并请求）。
   - 再评估升级利弊：
     - **Vercel Pro**（$20/月）：带宽 100GB → 1TB、函数执行 100GB-hrs → 1000GB-hrs、无每日构建限制；
     - **Neon Pro**（$19/月）：存储更大（10GB）、可关闭 scale-to-zero（消除冷启动）、分支/只读副本。
   - 给出“当前用量 → 预测耗尽时间 → 优化后预计可撑多久”的量化对比，不要只说“建议升级”。

3. **任何性能结论必须附带证据**（日志片段 / 指标数值 / 复现步骤），禁止主观猜测。

## 相关工具与脚本

- `scripts/check-resources.js`：Vercel 用量（≥70% 警告）+ Neon 存储（≥300MB 警告），退出码 0/2/1。
- `.github/workflows/resource-check.yml`：每周一 01:00 UTC 自动巡检，超阈值自动开 Issue「⚠️ 资源瓶颈预警」。
- Vercel Logs 搜索关键词：`ERROR`、`Function timed out`、`scrypt`、`[pay/`、`[db]`、`[agent-`。

## 底线

- 不擅自改阈值 / 不擅自升级套餐 / 不删除生产数据（先备份或确认）。
- 涉及付费变更时，给出利弊与替代方案，交由用户决策。
