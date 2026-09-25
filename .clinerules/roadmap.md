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
- 契约测试：`tests/achievements.test.mjs`（11 项）
- 联动：迁移步骤 3「元老探险家」徽章可直接以 badge_id='veteran-explorer' 写入 achievements 表发放（不占 8 枚常规徽章位）

---

## 三、旧版探索 V1 引导迁移到 V2（P0）

**目标**：统一用户体验，避免新老用户认知割裂，降低维护成本。

### 现状分析

- V1 探索：线性流程，事件少，无成就系统
- V2 探索：随机事件池（evt-001~040），支持新事件扩展，已有成就系统基础

### 迁移步骤

| 步骤 | 内容 | 优先级 | 状态 |
| --- | --- | --- | --- |
| 1 | 确认 V1 用户数据兼容性（探索次数、已触发事件等字段映射到 V2 表结构） | P0 | ✅ 2026-09-23 |
| 2 | V1 入口重定向到 V2 页面，保留 URL 兼容（/explore → /explore-v2） | P0 | ✅ 2026-09-23 |
| 3 | 为 V1 老用户发放"回归礼包"（补偿积分 + 专属徽章"元老探险家"） | P1 | ⬜ |
| 4 | 删除 V1 相关代码和路由，清理冗余 | P2 | ⬜ |
| 5 | 更新 README 和新手引导文案，统一指向 V2 | P2 | ⬜ |

### 数据兼容要点（2026-09-23 代码核实，修正原假设）

V1 真实形态：**没有独立的 /explore 页面**（git 历史确认），入口是聊天页的
`ExplorationMap` 挂件（`/api/exploration/step` 随每条聊天消息推进，
drizzle/0016_exploration.sql + src/lib/exploration-config.ts）。

| V1 数据（0016） | V2 落点（0020） | 映射结论 |
| --- | --- | --- |
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

_创建：2026-09-23。状态：任务三 V1→V2 迁移 🚧（步骤 1/2 ✅）；任务二 成就系统 ✅（2026-09-23）；任务一 新宠物扩展 ✅（2026-09-23）。_
