# 回滚指南 · P0 概念收敛 + P1 七需求 + P2 社交传播

> 适用范围：含 SCHEMA_VERSION 16→18 迁移的三批次版本（P0 概念收敛 / P1 七需求 / P2 社交传播）。
> 通用回滚手册见 `docs/rollback.md`（Phase 13）；本文只覆盖**本批次特有**的判断点与操作。
> 核心结论先行：**本批次 90% 的「上线事故」是迁移未完成，不是代码缺陷——先跑迁移，再谈回滚。**

---

## 一、判断点表格（症状 → 根因 → 动作）

| # | 症状 | 判断方法 | 根因 | 动作 |
| --- | --- | --- | --- | --- |
| 1 | 新版本代码已上线（新路由 401≠404），但引用新 schema 的接口 500：`/api/home/recall`、`/api/seasonal-events/active`、`/api/postcard-wall/*`、`PATCH profile(postcardWallPublic)`；旧功能全部正常 | `SELECT * FROM "_schema_meta";` → `version` 为 16/17 或 **-1** | **迁移未完成**（冷启动同步超 hobby 函数时限被杀，-1 = 死锁） | ❌ **不要回滚**。本地跑 `node --experimental-loader ./tests/_paths-loader.mjs scripts/db-migrate-prod.mjs`；version=-1 先清死锁行：`UPDATE "_schema_meta" SET version = 16 WHERE id = 1;`（将 -1 改回迁移前版本）再跑脚本 |
| 2 | P2 用例全挂（smoke-full P2 组 0/8）而 P0/P1 全绿 | 同上查 `_schema_meta` | 同 #1（P2 全部依赖 0032/0033 新对象） | 同 #1，迁移后重跑 `node scripts/smoke-full.mjs` 应 23/23 |
| 3 | 某接口 500，Logs 报 `operator does not exist: text = uuid`（PG 42883） | 报错 SQL 含 `adoptions`（或 `threads`/`push_subscriptions`）与 users 的跨表比较 | **代码漏 `::text` cast**：`adoptions.user_id`、`threads.user_id`、`push_subscriptions.user_id` 三列为 **text**（schema.ts 刻意保留以兼容游客 `'anonymous'` 与历史数据），与 `users.id`(uuid) 比较必须显式 cast（项目惯例：`a.user_id = u.id::text` / `user_id = $1::text`，见 admin/users、achievements-service） | ❌ **不要回滚**，修代码加 cast 即可（2026-10-15 实例：onboarding/recall 两 route 漏 cast，上线前冒烟抓获并已修复；修列类型不可行——text 是刻意设计且含非 uuid 值） |
| 4 | **全站 500 / 白屏 / 构建后样式全乱**，旧功能也无法访问 | Vercel Logs 大量 `ERROR`；`/zh/` 直接 500 | 代码级事故（非迁移问题） | ✅ **立即回滚**（§二 A 方案，分钟级） |
| 4 | 分享图接口 500/超时（`/api/soul-cards/[id]/share.png`、`postcard-wall share.png`），但对应页面正常 | Logs 搜 `share.png` 见 satori/ImageResponse 异常 | satori 渲染崩溃（字体/内存） | 单点故障，页面与 OG 标签仍可用 → **低危**，可带病观察；面大则回滚 P2 首 commit（§二 C） |
| 5 | 明信片墙公开页被投诉泄露隐私 | 用户反馈 / 舆情 | 开关语义误解或 bug | **应急（无需回滚）**：全量关闭开关 `UPDATE users SET postcard_wall_public = false;`（公开入口即刻全部 404），再排查 |
| 6 | 季节活动配置错误（奖励/时间填错） | 运营自查 | 数据配置问题 | **应急（无需回滚）**：`UPDATE seasonal_events SET is_active = false WHERE slug = '<slug>';` 活动即刻下线，进度行保留 |
| 7 | 首页「回来看看」banner 报错 | 浏览器控制台 | recall API 异常 | **天然降级**：组件失败静默不渲染，用户无感知 → 低危，随下一版本修复 |
| 8 | 支付/签到/聊天核心链路劣化（smoke-production 52 步出现非预期失败） | 跑 `node scripts/smoke-production.mjs` 定位 | 代码回归 | ✅ **回滚**（§二 A）；支付事故同时按 `docs/rollback.md` 通用流程通知 |

> 速记：**「新 500 旧正常」→ 迁移；「全挂」→ 回滚；「单点」→ 降级观察。**

## 二、回滚操作步骤

### A. Vercel 即时回滚（首选，分钟级，不动 git 历史）

1. Vercel Dashboard → 项目 `aiabw` → **Deployments**
2. 找到上一个 Ready 的生产部署（本批次推送前那条，commit `fddca12` 或之后 P1 顶端）
3. 右键/菜单 → **Redeploy**（或 `vercel redeploy <url>`）→ 确认 Promote to Production
4. 验证：`curl -s https://www.aiabw.com/zh/` 200 + `SELECT * FROM "_schema_meta"` 无需变动（见 §三）

### B. git revert + push（需要保留明确历史记录时）

```powershell
# 整批回滚（P2 四 commit，按依赖逆序）
git revert 6218bc3 d60c2a2 128c7f9 596b529 --no-edit
git push origin main
```

### C. 单 commit 粒度回滚（仅某一项功能出问题时）

| commit | 内容 | 单独 revert 的影响面 |
| --- | --- | --- |
| `596b529` | 灵魂卡分享图增强 + public 页 | 安全。public 页 404，分享图回退旧版（无阶段徽章/箴言）；share.png 路由内部自给自足 |
| `128c7f9` | 明信片墙公开页 + 隐私开关（SCHEMA 17） | 安全。设置页开关消失；**0032 列 `postcard_wall_public` 留库无害**（默认 false，旧代码不读） |
| `d60c2a2` | 季节活动骨架（SCHEMA 18） | 安全。`/api/seasonal-events/active` 消失（前端 banner 不渲染）；**0033 两表留库无害**；`exploration/start`、`pets/breed` 的进度挂点随代码移除 |
| `6218bc3` | 首页回来看看 | 安全。无 schema 变更；banner 组件与 API 成对消失 |

> 注意：`d60c2a2` 依赖 `128c7f9` 仅为版本号叙事（17→18），代码对象相互独立，可单独 revert 任意一个。

## 三、数据库注意事项（回滚代码 ≠ 回滚数据库）

1. **永远不要回退 `_schema_meta.version`**。版本闸门方向为
   `version >= SCHEMA_VERSION → 快速路径返回`（`src/db/client.ts`）：
   旧代码（SCHEMA_VERSION=16）遇到库里 version=18 会直接认为「已同步」并跳过 DDL——
   **提前/保留高版本 schema 对旧代码完全安全**。
2. **新增对象全部增量且向后兼容**：`postcard_wall_public`（boolean 默认 false）、
   `seasonal_events` / `user_seasonal_progress`（新表，占位活动 is_active=false）。
   旧代码不读这些对象；**不要 DROP**——回滚后再上线还要用，DROP 反而制造第二次迁移。
3. **version=-1 死锁处置**（迁移中断的唯一遗留态）：
   ```sql
   SELECT * FROM "_schema_meta";                                  -- 确认 version=-1
   SELECT pid, state, wait_event, query FROM pg_stat_activity
    WHERE datname = current_database();                           -- 确认无卡住的 DDL
   UPDATE "_schema_meta" SET version = 16 WHERE id = 1;           -- 解除认领锁（改回本批次前版本）
   ```
   然后本地重跑 `scripts/db-migrate-prod.mjs`（无函数时限，可跑完 ~60s 全量同步）。
4. **冒烟/测试数据**不属于回滚范围，清理见 `docs/RELEASE_CHECKLIST.md` 附录。
5. **应急数据操作**（比回滚更快的止血）：
   ```sql
   UPDATE users SET postcard_wall_public = false;                 -- 一键关闭全部公开明信片墙
   UPDATE seasonal_events SET is_active = false;                  -- 一键下线全部季节活动
   ```

## 四、灰度建议（hobby 套餐无平台灰度，用「开关即灰度」）

本批次功能**天然带灰度开关**，推荐按以下顺序放量而不是一次性全开：

| 功能 | 开关 | 灰度策略 |
| --- | --- | --- |
| 明信片墙公开页 | `users.postcard_wall_public`（默认关） | 发布后先只开**内部测试账号**验证分享链路（微信/Twitter 卡片解析），无异常再公告引导用户开启 |
| 季节活动 | `seasonal_events.is_active`（占位 false） | 首个真实活动上线时：先 `is_active=true` + 内部账号探索/繁育验证进度累计与 banner → 正常后公告 |
| 回来看看 | 组件静默失败（无开关） | 低风险直接全量；观察 Vercel Logs `/api/home/recall` 耗时 |
| 灵魂卡 public 页 | 无开关（卡粒度公开） | 低风险：仅含公开凭证信息，noindex 防收录；抽查分享图渲染耗时即可 |

发布窗口：北京时间上午低峰推送 → 阶段 1-3 通过后**观察 2h** 再对外公告新功能；
24h 内 Logs/Neon 无异常 → 发布完成。

---

_创建：2026-10-15 · 配套 `docs/RELEASE_CHECKLIST.md` 与 `scripts/smoke-full.mjs`（23 用例）。_
