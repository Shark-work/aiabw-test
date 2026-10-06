# Roadmap（迭代规划）

> 艾比世界后续迭代的总体规划。**每次执行任务前优先参考本文档**，按推荐顺序与优先级拾取工作；
> 单项落地后更新对应状态（✅ 完成 / 🚧 进行中），完成后可从本文档移除并归档。
> 临时性/暂缓事项仍记录于 `backlog.md`，运维规范见 `ops-rules.md`。

---

## 一、新宠物扩展：垂耳兔 & 玄凤鹦鹉（P1）

**目标**：扩充宠物池，丰富养成体验，提升用户留存与付费意愿。

### 垂耳兔（普通系/草系）

- **人设**：温顺胆小、爱撒娇，被摸耳朵会害羞地跺脚
- **探索特性**：擅长发现隐藏食物（野菜、胡萝卜），探索时额外掉落食材类道具
- **互动动作**：蹭手、竖耳倾听、蹦跳、缩成一团睡觉
- **解锁条件**：新手期即可领养，降低入门门槛

### 玄凤鹦鹉（普通系/电系）

- **人设**：话痨活泼、好奇心强，喜欢模仿主人说话的语气
- **探索特性**：高空视野优势，探索时概率发现稀有事件（如空中奇遇、远山宝藏）
- **互动动作**：歪头杀、展翅、吹口哨、站肩膀
- **解锁条件**：探索成就解锁或活动限时获取，作为中期目标宠物

### 数据落地

- 在 `src/data/animals.ts`（或类似宠物数据文件）中新增两个物种条目
- 配套新增 20-30 条专属对话语料（人设相关）
- 新增 15-20 条专属探索事件（evt-041~060）
- 准备立绘/表情包素材（可先用 AI 生成占位，后续替换）

### 落地状态（✅ 2026-09-23）

- 百科：`animal_wiki` 新增 lop-rabbit（垂耳兔，category=兔）+ cockatiel（玄凤鹦鹉，category=鹦鹉）种子（src/db/client.ts，ON CONFLICT 幂等；traits/fun_facts 各 5 条）
- 探索事件：evt-041~060 共 20 条（rabbit 10 + bird 10；5 类 × 3 稀有度；垂耳兔 3 条食材类 gift 呼应「额外掉落食材」，玄凤鹦鹉 rare+epic 6 条呼应「高空视野发现稀有事件」，含 evt-057 空中奇遇 / evt-060 远山宝藏）
- 对话语料：i18n `newPets` 命名空间（zh/en 各 30 条人设台词 + 互动动作 + 解锁说明；avatarEmoji 🐰/🦜 作立绘占位，后续替换正式素材）
- 成就联动：REWARD_NOTE_BADGES 已关联 探险新手→垂耳兔 / 奇遇猎人→玄凤鹦鹉（任务二落地，本任务测试锁定）；「百科达人」target=5 随本批 2 条百科落地正式可达（persian-cat/red-fox/shiba-inu/lop-rabbit/cockatiel）
- SCHEMA_VERSION 2→3（生产库自动同步种子）；契约测试 tests/new-animals.test.mjs（11 项）

---

## 二、探索成就系统（徽章/进度条）（P1）

**目标**：给探索玩法增加长期目标感，激励用户持续游玩，提升 DAU。

### 徽章体系设计

| 徽章名称 | 解锁条件 | 奖励 |
| --- | --- | --- |
| 初出茅庐 | 完成首次探索 | 5 积分 |
| 探险新手 | 累计探索 10 次 | 10 积分 + 垂耳兔解锁资格 |
| 足迹遍布 | 触发全部普通事件（evt-001~020） | 20 积分 |
| 奇遇猎人 | 触发全部稀有事件（evt-021~040） | 30 积分 + 玄凤鹦鹉解锁资格 |
| 百科达人 | 解锁 5 种宠物百科 | 15 积分 |
| 亲密无间 | 与任意宠物亲密度达满级 | 25 积分 + 专属称号 |
| 全勤奖 | 连续登录 7 天 | 35 积分 |
| 艾比大师 | 解锁全部徽章 | 100 积分 + 限定头像框 |

### 进度条设计

- 在探索页面顶部显示当前徽章进度（如 3/8 徽章已解锁）
- 点击可展开详细列表，显示每个徽章的解锁条件和当前进度百分比
- 解锁时弹出庆祝动画 + 积分到账提示

### 技术落地

- 新增 `achievements` 表（用户 ID + 徽章 ID + 解锁时间）
- 新增 `achievement_progress` 表（用户 ID + 徽章 ID + 当前进度值）
- 在探索完成、登录、百科解锁等关键节点触发进度更新检查
- 前端新增成就面板组件

### 落地状态（✅ 2026-09-23）

- 徽章定义与纯函数评估器：`src/lib/achievements-config.ts`（8 徽章/奖励/目标值与上表一致）
- 服务端聚合：`src/lib/achievements-service.ts`（单 SQL 聚合全源表统计；事务化解锁 + 积分入账 users.points + points_log reason='achievement'；UNIQUE(user_id,badge_id) 幂等）
- **规格修正**：不设 `achievement_progress` 表——全部进度可由源表实时推导（exploration_records / knowledge_link / checkin_streak / adoptions.happiness / V1 口径折算），冗余进度表有双写不一致风险且无法自动覆盖 V1 老数据；`achievements.progress` 仅存解锁时快照
- 「亲密无间」数据源核实：代码无独立 intimacy 字段 → 采用 `adoptions.happiness`（0-100，/api/interact 维护）满值 100
- 「百科达人」当前进度上限 3/5（wiki 现有 persian-cat/red-fox/shiba-inu），垂耳兔/玄凤鹦鹉（任务一）落地后自然可达 5/5
- 触发节点：`POST /api/exploration/start`（探索完成即时解锁 + newlyUnlocked 庆祝）、`GET /api/achievements`（面板加载惰性评估，覆盖签到/亲密度等非探索节点）
- 前端：`AchievementPanel`（explore-v2 页顶部 x/8 进度条 + 展开列表 + 庆祝弹窗）+ 探索结果弹窗内嵌徽章庆祝；i18n `achievements` 双语
- 数据表：`achievements`（drizzle/0021；SCHEMA_VERSION 2 生产自动同步）
- 契约测试：`tests/achievements.test.mjs`（14 项）
- 联动：迁移步骤 3「元老探险家」徽章可直接以 badge_id='veteran-explorer' 写入 achievements 表发放（不占 8 枚常规徽章位）

---

## 三、旧版探索 V1 引导迁移到 V2（P0）✅ 已完成

**目标**：统一用户体验，避免新老用户认知割裂，降低维护成本。

### 现状分析

- V1 探索：线性流程，事件少，无成就系统
- V2 探索：随机事件池（evt-001~040），支持新事件扩展，已有成就系统基础

### 迁移步骤

| 步骤 | 内容 | 优先级 | 状态 |
| --- | --- | --- | --- |
| 1 | 确认 V1 用户数据兼容性（探索次数、已触发事件等字段映射到 V2 表结构） | P0 | ✅ 2026-09-23 |
| 2 | V1 入口重定向到 V2 页面，保留 URL 兼容（/explore → /explore-v2） | P0 | ✅ 2026-09-23 |
| 3 | 为 V1 老用户发放"回归礼包"（补偿积分 + 专属徽章"元老探险家"） | P1 | ✅ 2026-09-23 |
| 4 | 删除 V1 相关代码和路由，清理冗余 | P2 | ✅ 2026-09-23 |
| 5 | 更新 README 和新手引导文案，统一指向 V2 | P2 | ✅ 2026-09-23 |

### 数据兼容要点（2026-09-23 代码核实，修正原假设）

V1 真实形态：**没有独立的 /explore 页面**（git 历史确认），入口是聊天页的
`ExplorationMap` 挂件（`/api/exploration/step` 随每条聊天消息推进，
drizzle/0016_exploration.sql + src/lib/exploration-config.ts）。

| V1 数据（0016） | V2 落点（0020） | 映射结论 |
| --- | --- | --- |


---

## Phase 7 · 前端页面全面改造（✅ 2026-10-16，4 批次）

| 批次 | 内容 | 提交 |
| --- | --- | --- |
| 1 · 首页（7.1） | slogan 对齐四维度 / 探索·商城次级 CTA / 灵魂卡轮播（新 API /api/soul-cards/featured，60s 缓存，稀有度权重）/ 社区活跃数据条（新 API /api/home/stats，单 SQL 4 指标） | `40db094` |
| 2 · 灵魂卡页（7.4） | 3D 翻转卡背（稳定箴言，burned/reduced-motion 豁免）/ 收藏进度面板（稀有度分布+元素点亮）/ 社区热门 tab（featured 扩展卡面全字段，owner/链哈希不返回）/ 卡片对比（≤2 张，高者高亮） | `a03ae8e` |
| 3 · 装扮商城（7.6） | 限时特惠横幅（三态复用首充/充值事件总线，不虚构折扣）/ 宠物穿戴预览 / 我的收藏 tab / 推荐搭配（最低价 skin×effect）/ 获取方式说明 | `67bf00d` |
| 4 · 明信片分享（7.8） | 分享图模板选择（?template=classic/night/blossom，localStorage 记忆）/ 分享奖励（每日首次 +5，points_log.ref 唯一幂等防刷，事务化） | `37fb2f2` |

- 既有覆盖声明：7.1-2 热门宠物=featured 区块；7.7 积分入口=Phase 4；7.8-2/4/5=P2 社交传播批次；全局 UI 加载/错误=common 命名空间既有模式。
- 零 schema 变更（SCHEMA_VERSION 维持 19）；4 批次契约测试 32 项（home/soul-cards/shop/postcard-share phase7），全量回归 683/683 + tsc 0 错误。
- 下一 Phase：Phase 8 · AI 集成优化与成本控制（响应缓存/降级/审核/限流）。

---

## Phase 8 · AI 集成优化与成本控制（✅ 2026-10-16，2 批次）

| 批次 | 内容 | 提交 |
| --- | --- | --- |
| 8A · 缓存+降级 | ai_response_cache/content_reports 两表（drizzle/0035，SCHEMA_VERSION 20）/ ai-cache.ts（DB 缓存层：sha256 归一化 key、hits 命中计数、惰性过期、全链路容错）/ llm-fallback.ts（AI_MAX_CONCURRENCY=6 并发槽 AiBusyError + generateWithFallback 跨 provider 顺序重试 AggregateError + generateCached/generateThrottled 两入口）/ get-model.ts getModelCandidates+buildChatModel（getModel() 不变）/ 接入 name-suggestions（TTL 7d）+ agent-psychology / GET /api/admin/ai-stats | `67668c3` |
| 8B · 审核+举报+限流 | content-moderation.ts（高置信词表+零宽归一化+filterClean；刻意不收情绪词）/ rate-limit.ts（chat 20/min、explore 12/min、reports 10/h、ugc 20/h；429+Retry-After+i18n）/ 接入 chat（限流+审核先于 streamText/配额）、exploration/start、creator/publish、adopt、name-suggestions 输出 / POST /api/reports（uq 幂等）/ admin reports GET+PATCH（pending 先报先审、仅 pending 可处置、resolved_by 审计、409）+ /admin/moderation 面板（+AI 成本监控条 `07f22ee`）/ 顺带修复 admin-shell.tsx 历史 mojibake | `fe8c79d` |

- 红线：聊天流式链路不缓存（千人千面 system prompt + SSE 重试语义）；词表只收高置信违规词（误伤成本>漏放成本，情绪倾诉由宠物温柔回应）。
- ⚠️ **部署警示**：SCHEMA_VERSION 19→20，推送上线后必须手动跑 `scripts/db-migrate-prod.mjs`（ops-rules 红线），确认 `_schema_meta.version=20` 再跑 smoke。
- 契约测试 ai-phase8.test.mjs 19 项（8A 9 项 + 8B 10 项，含 moderateText 运行时单测）；全量回归 702/702 + tsc 0；旧断言演进 8 文件（SCHEMA_VERSION 19→20 / 0035 豁免）。
- 后续可选（未做，非阻塞）：memory/handbook/social-poster 三处 getModel 直调可迁移 generateThrottled；moderation 词表可叠加阿里云内容安全 API（接口不变）；限流可换 Redis 实现多实例精确配额（接口不变）。

---

## Phase 9 · 测试、部署与上线（✅ 2026-10-16）

**上线窗口**：本地 15+1 commit 一次性推送（Phase 4~8 + 构建修复），生产从 Phase 3 直升 Phase 8。

| 步骤 | 结果 |
| --- | --- |
| 全量测试 | ✅ 702/702 + tsc 0 + 本地 `npm run build` 204/204 静态页 |
| 生产迁移（预跑） | ✅ `db-migrate-prod.mjs`：`_schema_meta.version=20`，13 项校验全过；**先于部署完成**（DDL 纯增量旧版 v19 兼容），新实例冷启动走快速路径，规避 v12 式超时死锁 |
| 首次部署 | ❌ 失败——ESLint `no-unused-vars` 2 处阻断构建（轮询 16 分钟 /api/reports 持续 404 定位） |
| 阻断修复 `cbc2e21` | `promote-modal.tsx` 历史编辑事故：`submit()` 的 `finally` 块吞掉整个组件 JSX（return 落入 finally、文件末尾孤儿 `setSubmitting(false)`），**「确认推广」按钮从未渲染**（功能缺陷）+ ESLint unused；`leaderboard-v2.tsx` 未用 `tc` 钩子。修复后本地 build 通过再推 |
| 二次部署 | ✅ `/api/reports` 404→401 确认新版上线 |
| 生产冒烟 | ✅ `smoke-production.mjs` **35/35**（8 页面/注册登录/卡包/道具/融合/销毁/支付降级/webhook/繁育/转赠/补签） |
| 关键功能活性 | ✅ 首页·排行榜·探索页·`/admin/moderation` 均 200；reports/ai-stats/admin-reports/chat 新端点 401 鉴权正常；leaderboard API 200 |
| DNS | ✅ `aiabw.com` A → 216.198.79.1 / 64.29.17.1（Vercel Anycast），apex 308→www |
| 环境变量（附录 D 核对） | ✅ 本地 .env/.env.local 齐全（DATABASE_URL/DEEPSEEK/BAILIAN/XORPAY_AID+SECRET/STRIPE/CHAIN/BLOB）；生产经运行时行为验证（登录 401 活性/支付 503 降级/webhook 验签）；附录 D 命名差异已确认：JWT_SECRET→实际 AUTH_SECRET、XORPAY_API_KEY→实际 XORPAY_AID+XORPAY_SECRET |

**遗留（非阻塞）**：
- Vercel 残留失效 `OPENAI_API_KEY`（ark）——backlog P3，用户决定暂不处理（DEEPSEEK 主链路挡住，失效才会静默 fallback）。
- 限流 429 未在生产实际触发（避免污染），逻辑由契约测试锁定。
- 聊天真实 AI 对话未在生产深验（省 token），活性 401 + 本地回归覆盖。
- smoke 测试用户（prod-smoke-*@test.dev）经 `cleanup-smoke-users.mjs` 清理。

| `adoptions.exploration_steps`（按宠物累计步数，每消息 +10） | `exploration_records`（按用户每次一行） | ❌ V1 无 `exploration_count` 字段；换算口径：完成地图数 = Σsteps ÷ 100（每图 100 步） |
| `user_postcards`（每完成一张地图生成一张） | 探索次数计数 | ✅ V1「探索次数」≈ `COUNT(user_postcards)`，与上一条交叉校验取 max |
| `map_events` 事件触发（应用层即时抽取，不落库） | `exploration_records.event_id`（evt-001~040） | ❌ 不可迁移：V1 触发无用户维度持久化、无稳定事件 ID；奇遇类徽章 V1 用户从 0 开始 |
| `user_items`（source='exploration'） | — | ✅ 原表保留，背包通用，无需迁移 |
| `user_postcards` 内容 | — | ✅ 原表保留，V1 明信片继续可查看 |

- 原假设「`exploration_count` 直接迁移」「事件 ID 合并到 `triggered_events`」经核实**不成立**（字段/数组均不存在），按上表修正。
- V1 用户的累计探索次数自动计入 V2 徽章进度（如"探险新手"徽章），口径 = `max(Σ adoptions.exploration_steps ÷ 100, COUNT(user_postcards))`，由成就系统（任务二）落地时执行回填。
- 步数量纲不同（V1 每消息 10 步 vs V2 每次 500-3000 步）→ 只按**次数**映射，不按步数。

**入口迁移（步骤 2 落地，2026-09-23）：**

- 新建 `/[locale]/explore` 页面 308 永久重定向 → `/[locale]/explore-v2`（/explore 经 middleware 自动补 locale 前缀，URL 兼容旧书签/外链）。
- `ExplorationMap` 挂件（V1 真实入口）顶部加 V2 引导条（`exploration.v2Banner` 双语），导航栏已统一指向 /explore-v2。
- 迁移期 V1 系统（step/status/postcards API、挂件、0016 各表）保持可用，删除属于步骤 4（P2）。契约测试：tests/explore-v1-migration.test.mjs。

**回归礼包（步骤 3 落地，2026-09-23）：**

- `syncAchievements` 首次检查识别 V1 老用户（`COUNT(user_postcards) >= 1`）→ 事务性写入 `achievements`（badge_id=`veteran-explorer`，progress=明信片数快照）+ `users.points +20` + `points_log(reason='achievement')`；UNIQUE(user_id,badge_id) + ON CONFLICT DO NOTHING 保证重复调用/并发幂等。
- 探索次数类徽章（初出茅庐/探险新手）进度按 `max(Σsteps÷100, COUNT(postcards))` 实时回填进 `totalExplorations`（任务二折算口径），V1 用户首次同步即自动达标解锁。
- 徽章不占 8 枚常规位、不计入 master/面板计数；庆祝弹窗经 `badgeNameMessageKey` 回退查名（i18n `achievements.veteranBadge` 双语）。契约测试：tests/achievements.test.mjs 新增 3 项（12~14）。

**代码清理 + 文案统一（步骤 4/5 落地，2026-09-23）：**

- 删除 V1 运行时代码：`/api/exploration/{step,status,postcards}` 路由、`ExplorationMap` 挂件（chat-client / chat 页 SSR 接线同步移除）、`src/lib/exploration-config.ts`、`drizzle/0016_exploration.sql`；`/api/pet/status` 剔除 4 个探索字段；`adoptions.current_map_id / map_progress / weather` 与 `map_events` 从 schema.ts / client.ts 移除（生产存量对象不 DROP，冷存储；新装库不再创建）。
- 保留（成就系统依赖）：`user_postcards` 原表 + `adoptions.exploration_steps` 列（V1 折算口径 + 回归礼包数据源）；`/explore` 308 重定向永久保留（URL 兼容旧书签/外链）；`start/history/quota` 为 V2 路由，不在删除范围。
- 文案统一：删除 i18n `exploration.*` 整个命名空间（zh/en，仅挂件使用）与无引用的 `explorationV2.idleHint`（"挂机探索（二期即将上线）"过时文案）；README 模块表/目录树统一为 V2 描述；导航 `navExplore` 已是「🗺️ 探索」双语统一。
- 契约测试：删除 tests/exploration.test.mjs、tests/explore-v1-migration.test.mjs（迁移期使命完成）；tests/exploration-v2.test.mjs 新增 #21（308 重定向保留 + V1 文件不复存在 + V2 路由仍在）；tests/shop.test.mjs 移除 applyEquipmentToSteps 用例（随 exploration-config 删除，商城其余用例不受影响）。

---

## 四、执行建议

### 推荐顺序

1. **先做 V1→V2 迁移**（P0，清理技术债，统一体验）
2. **再做成就系统**（P1，提升留存，为后续宠物扩展打基础）
3. **最后扩展新宠物**（P1，内容填充，配合成就系统作为解锁奖励）

### 时间估算

- V1→V2 迁移：1-2 天
- 成就系统：3-4 天（含前后端 + 测试）
- 新宠物扩展：2-3 天/只（含数据 + 对话 + 事件 + 素材）

---

_创建：2026-09-23。状态：任务三 V1→V2 迁移 ✅（步骤 1/2/3/4/5 全部完成，2026-09-23）；任务二 成就系统 ✅（2026-09-23）；任务一 新宠物扩展 ✅（2026-09-23）。_
