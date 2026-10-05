# 上线验证清单 · P0 概念收敛 + P1 七需求 + P2 社交传播

> 适用范围：本仓库 `main` 分支包含 P0（概念收敛 4+1 commit）、P1（七需求 7 commit）、
> P2（社交传播 4 commit）三个批次的版本发布。配套文档：
> - 自动化冒烟：`scripts/smoke-full.mjs`（23 用例，本清单阶段 3 执行）
> - 回滚处置：`docs/ROLLBACK_GUIDE.md`（判断点表格 + 操作步骤）
> - 通用部署步骤：`VERCEL_DEPLOY.md`；历史通用清单：`CHECKLIST.md`（Phase 10）
>
> ⚠️ 本批次含 **SCHEMA_VERSION 16 → 18 两次 bump**（0032 明信片墙公开开关 + 0033 季节活动两表），
> 阶段 2 数据库迁移为**强制手动步骤**，不可跳过（ops-rules 2026-10-03 事故教训：
> 冷启动全量同步 ~60s 超 hobby 函数时限必被杀，`_schema_meta.version` 遗留 -1 死锁）。

---

## 阶段 0 · 部署前（本地门禁）

| # | 检查项 | 命令 / 位置 | 通过标准 |
| --- | --- | --- | --- |
| 0.1 | TypeScript 零错误 | `npx tsc --noEmit` | 无输出 |
| 0.2 | 契约测试全量绿 | `npm test` | 575/575（基线 523 + 本三批 52） |
| 0.3 | 生产构建通过 | `npx next build` | 190/190 页面，无 type error |
| 0.4 | 工作区干净 | `git status` | 无未提交改动；commit 在 `main` 顶端 |
| 0.5 | Vercel 环境变量核对 | Vercel Dashboard → Settings → Environment Variables | `DEEPSEEK_API_KEY` 存在且有效；**无残留 `OPENAI_API_KEY`**（backlog P3：坏 ark key 会在 DeepSeek 失效时静默 fallback）；`DATABASE_URL` 指向生产 pooler |
| 0.6 | 迁移脚本可用 | `node --experimental-loader ./tests/_paths-loader.mjs scripts/db-migrate-prod.mjs` 干跑环境就绪 | 本地 Node ≥ 20、`.env`/`.env.local` 有 `DATABASE_URL` |
| 0.7 | 低流量发布窗口 | — | 建议北京时间上午低峰；避开运营活动时段 |
| 0.8 | 混合类型列 cast 核查（本批次已修复：onboarding/recall） | 新 SQL 涉及 `adoptions`/`threads`/`push_subscriptions` 的 user_id 与 users.id 比较时 | 必须显式 cast（`u.id::text` 或 `$1::text`）——三列为 text（游客兼容设计），漏 cast 在混合类型库必炸 42883；契约测试（PGlite）与源码断言测不出，**只有对真实 Neon 库的冒烟能抓获** |

## 阶段 1 · 部署

| # | 步骤 | 验证 |
| --- | --- | --- |
| 1.1 | `git push origin main` | Vercel 自动触发 production deployment |
| 1.2 | 等 deployment **Ready**（Vercel Dashboard / `vercel ls`） | 新 commit hash 与本地 `git rev-parse HEAD` 一致 |
| 1.3 | 新版本探活：`curl -s -o /dev/null -w "%{http_code}" https://www.aiabw.com/zh/` | 200（旧功能已可用） |

## 阶段 2 · 数据库迁移（强制，推送后立即执行）

| # | 步骤 | 通过标准 |
| --- | --- | --- |
| 2.1 | 立即执行：`node --experimental-loader ./tests/_paths-loader.mjs scripts/db-migrate-prod.mjs` | 输出 `[db] schema synced to version 18`（脚本文案校验 ≥v9 为历史基线，以本行日志为准） |
| 2.2 | 确认版本落点：`SELECT * FROM "_schema_meta";` | `version = 18`（**-1 = 死锁**，见 ROLLBACK_GUIDE §三） |
| 2.3 | 新对象抽查（诊断三连后两条）：`SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='postcard_wall_public';` 应返回 1 行；`SELECT tablename FROM pg_tables WHERE tablename IN ('seasonal_events','user_seasonal_progress');` 应返回 2 行 | 0032 列 + 0033 两表就位 |
| 2.4 | 占位活动种子：`SELECT slug, is_active FROM seasonal_events;` | `placeholder` 行存在且 `is_active=false` |

> 若 2.1 失败或 2.2 为 -1：**不要回滚代码**，按 `docs/ROLLBACK_GUIDE.md` §一判断点表第 1-2 行处置（重跑迁移 / 清理死锁行）。

## 阶段 3 · 自动化冒烟

| # | 步骤 | 通过标准 |
| --- | --- | --- |
| 3.0 | **版本指纹确认**（防在旧部署上误跑）：`curl -sL https://www.aiabw.com/zh` grep 本次 release 的新文案（如「灵魂养成与数字凭证」）+ `curl -s -o NUL -w %{http_code} https://www.aiabw.com/api/<新路由>` | 新文案在 HTML 中；新路由返回 **401/200（≠404）**。不满足 = 目标 commit 未上线，**等 Vercel 部署完成再跑**（2026-10-15 实例：旧部署上冒烟 8/23 误报 15 失败，新部署完成后 23/23 自愈，零代码修复） |
| 3.1 | `node scripts/smoke-full.mjs`（默认打 https://www.aiabw.com） | **23/23 全绿**，输出 `ALL_SMOKE_FULL_OK`，退出码 0 |
| 3.2 | 失败处置 | 按失败组定位：P2 组全挂而 P0/P1 绿 → 大概率为迁移未完成（回阶段 2）；**整批新路由 404** → 先回 3.0 确认部署版本；杂散失败 → ROLLBACK_GUIDE §一 |
| 3.3 | （可选·深度）`$env:DATABASE_URL=...; node scripts/smoke-production.mjs` | 52/52，基础交易链路无回归（含 SQL 充值，留流水痕迹） |

## 阶段 4 · 人工验证（浏览器实操，逐项打勾）

### P0 概念收敛
- [ ] 新注册账号走唤醒仪式三步（候选 → 唤醒 → 命名），完成后灵魂卡自动出现在收藏中心，**全程无「铸造/mint/链上」字样**
- [ ] `/soul-cards` 双 Tab（我的灵宠 / 世界藏品）切换正常，`?tab=aibi` 旧链接兜底落「我的灵宠」
- [ ] `/packs` 卡包购买按钮为停售态（点击不产生订单）
- [ ] 邀请页/设置页找到自己的邀请码；文案含「双方各得 3 天 VIP」
- [ ] 已有连签账号断签场景：签到弹窗出现补签卡片 → Xorpay 扫码 ¥1（可用测试账号真付或只验证弹窗出现）
- [ ] 全站抽查 3-5 页（首页/探索/聊天/设置）无「NFT/链上」残留表述

### P1 七需求
- [ ] 首次探索后结果弹窗展示明信片/礼物/知识，且弹出「初出茅庐」徽章庆祝
- [ ] `/explore-v2` 页面成就面板显示 1/8 进度；探索履历区出现刚才的记录
- [ ] 灵魂卡详情页故事线区：探索次数 1、唤醒日里程碑可见
- [ ] 灵魂卡卡面为初始阶段（种子档）样式；互动后成长值增加
- [ ] 签到后 streak=1，刷新页面/重进仍保持
- [ ] `/pets/my` 聚合页伙伴/收藏双 Tab 正常，`/my-pets` 旧链接 308 跳转
- [ ] 收藏中心 NFR Tab 卡片显示「繁育」入口（文案为羁绊结晶叙事）

### P2 社交传播
- [ ] 灵魂卡详情页分享按钮：移动端唤起系统分享 / 桌面端下载 PNG，图片含**阶段徽章 + 灵魂箴言 + 编号 + 域名水印**
- [ ] 复制公开链接 `/soul-cards/[id]/public` 在无登录隐身窗口可打开；卡片编号/稀有度正确；页面源码含 `noindex` 与 `og:image`
- [ ] 明信片墙（`/explore-v2` 结果或入口进）五系列进度正确；设置页开启「公开明信片墙」→ 复制 `/postcard-wall/[userId]` 隐身窗口可开；**关闭后隐身窗口立即 404**
- [ ] 首页「回来看看」：用 24h+ 未登录测试账号登录 → banner 出现「艾比想你了」；集齐一个明信片系列未领奖 → 奖励提醒出现并跳转 `/explore-v2`
- [ ] 季节活动：当前无进行中活动（banner 不显示）——属预期，占位活动不外露

## 阶段 5 · 监控观察（发布后 24h）

| 观察点 | 位置 | 告警线 |
| --- | --- | --- |
| 函数报错 | Vercel → 项目 → Logs，搜 `ERROR`、`[pay/`、`[db]`、`Function timed out` | 任一 5xx 持续 > 5min → ROLLBACK_GUIDE §一 |
| 新接口耗时 | Logs 搜 `share.png`、`postcard-wall`、`recall` | p95 > 10s（satori 渲染慢）→ 评估降级 |
| 数据库 | Neon Console → Monitoring | 连接数/计算时长突增 → `scripts/check-resources.js` 量化 |
| 迁移残留 | `SELECT * FROM "_schema_meta"` | version ≠ 18 或 -1 → 立即处置 |
| 冒烟痕迹 | — | 可保留观察或按附录清理 |

## 附录 · 冒烟测试痕迹清理（可选）

```powershell
# smoke-full.mjs / smoke-production.mjs 产生的测试用户及全部关联数据
node scripts/cleanup-smoke-users.mjs            # dry-run：先确认范围（仅统计）
node scripts/cleanup-smoke-users.mjs --execute  # 事务性清理 + 前后对比（CLEANUP_OK）
```

> ⚠️ 不要用单条 `DELETE FROM users WHERE email LIKE ...`：生产库 FK 无 CASCADE，
> 会被 achievements/adoptions/points_log 等 19+ 子表挡住。脚本自动发现关联表
> （FK ∪ user 语义列 ∪ 入向 FK BFS），pets 实例释放回池而非删除。
> 执行记录存档：docs/cleanup-smoke-execution-*.md（2026-10-05 清理 51 用户 / 907 行）。

---

_创建：2026-10-15 · 覆盖 P0 概念收敛 / P1 七需求 / P2 社交传播三批次（SCHEMA_VERSION 18）。_
