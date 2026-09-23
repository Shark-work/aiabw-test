# Backlog（待办池）

> 记录已评估但暂不执行的事项，供后续会话/迭代拾取。完成后删除对应条目。

## P3 · Vercel 环境变量治理（2026-09-23 评估，用户决定暂不处理）

- **背景**：Vercel 生产环境残留失效的 `OPENAI_API_KEY`（ark- key，调用返回 401）。`get-model.ts` 回退链为 `DEEPSEEK → OPENAI → BAILIAN`，平时被 DEEPSEEK 挡住无害；一旦 DeepSeek key 失效/欠费，全站 AI 会静默 fallback 到这个坏 key 上。
- **处置方案**：Vercel Dashboard → 项目 `aiabw` → Settings → Environment Variables，删除 `OPENAI_API_KEY`（及残留的 `OPENAI_BASE_URL` / `OPENAI_MODEL`，若指向 ark 端点）；保留 `DEEPSEEK_API_KEY` 为唯一 AI key。或用 Vercel REST API 清理（projectId / teamId 见 `.vercel/project.json`，需 VERCEL_TOKEN）。
- **附注**：本地 `.env.local` 中的 `ARK_API_KEY` / `ANTHROPIC_API_KEY` 代码从不读取（已全仓搜索确认），属本地工具变量，无需同步到 Vercel。
