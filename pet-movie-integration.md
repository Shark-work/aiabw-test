# 宠物剧场 / 互动页集成文档（pet-movie-integration）

> AI 宠物模块（`/pet-movie` 剧场页 + `/pets/my/[id]/play` 互动页）的统一集成文档。
> 2026-10-17 Phase 12 框架性修复：统一角色数据源 / Rive 状态机契约统一 / 背包喂食闭环 /
> 积分免费额度与退款 / 双维限流与成本观测 / 沉浸式体验 / 埋点。

---

## 1. 角色配置结构（统一角色数据源，`src/lib/pets/characters.ts`）

**单一事实源**：人设、System Prompt、开场白、台词库、Rive 资产 key、降级立绘全部在角色注册表
`PET_CHARACTERS` 中；组件与 API 一律经 `resolveCharacter(petType)` 取角色，
**禁止在任何组件里硬编码角色文案**（「显示雪豹但文案是橘猫」错配的根治点）。

```ts
interface PetCharacter {
  id: string;                  // "worker-cat" | "aibi-spirit"
  nameZh / nameEn: string;     // 角色展示名
  species: readonly string[];  // 匹配的物种 id（species:<id> 的 id 部分；空数组 = 兜底角色）
  personality: string;         // 人设一句话
  riveFileKey: string;         // Rive 资产 key（/api/pet/asset?name=<key>）
  fallbackImage: string;       // 降级立绘（空串 = 由 API 按宠物 petType 运行时派生）
  greetingZh / greetingEn: string;            // 开场白（经 API character.greeting 下发）
  linesZh / linesEn: Record<PetMood, string[]>;  // 台词库：7 情绪 × 双语（本地兜底回复）
  buildSystemPrompt(opts): string;            // System Prompt 构建器（服务端专用）
}
```

| 角色 | 匹配 | 人设 |
| --- | --- | --- |
| `worker-cat` 打工橘猫 | `species:persian` | 嘴硬心软 / 爱摸鱼 / 打工梗（KPI、周报、涨薪） |
| `aibi-spirit` 艾比灵宠 | 其余全部物种 + 官方宠物（fox/penguin/dog）+ 未知类型 | 温柔治愈 / 陪伴型 / 艾比大陆见闻 |

**解析规则**：`resolveCharacter("species:persian") → worker-cat`；其余一律 `aibi-spirit`。
新增角色 = 注册表追加条目 + `species` 列表填写匹配物种 id，零路由/组件改动。

**防抄袭红线**：characters.ts 含 prompt 构建器与台词库，**只能服务端 import**；
前端经 `/api/pet/play|movie` 响应的 `character: { id, displayName, greeting }` 子对象获取展示层字段
（`characterView()` 最小子集，零 prompt、零台词库）。页面标题走 i18n；输入框占位符
`petPlay.inputPlaceholder` 为 `"和 {name} 说点什么…"`（宠物名参数化）。

---

## 2. 情绪映射表（统一命名，`characters.ts` 导出，pet-play-config re-export）

### 2.1 情绪白名单 `PET_MOODS`（7 值，Rive Number 输入「emotion」索引序）

| 索引 | mood | 含义 | 映射动作（MOOD_ACTION_MAP） |
| --- | --- | --- | --- |
| 0 | `idle` | 待机 | `idle` |
| 1 | `happy` | 开心 | `happy` |
| 2 | `sad` | 难过 | `sad` |
| 3 | `angry` | 生气 | `angry` |
| 4 | `hungry` | 饥饿 | `eat` |
| 5 | `thinking` | 思考 | `think` |
| 6 | `sleepy` | 困倦 | `sleep` |

### 2.2 动作白名单 `PET_ACTIONS`（Rive Trigger，同名 fire）

`idle / eat / sleep / think / wave / happy / sad / angry / rub`
（`rub` = 蹭蹭：前端点击宠物直接 fire 的互动动作位，不占情绪位。）

### 2.3 统一 LLM 输出契约（需求三.3）

```json
{ "text": "<回复文本>", "mood": "<PET_MOODS 之一>", "intensity": 0 }
```

- 大模型**只返回 { text, mood, intensity }**——**不返回动画名**；
  动作由服务端 `MOOD_ACTION_MAP` 推导（需求三.2 红线，prompt 契约段不注入动作名）。
- `mood` 越界 → 归一 `idle`；`intensity` 缺省 1、钳制 0-2（`parsePetChatResponse`）。
- `intensity` → Rive Number 输入「intensity」（资产未做该输入时前端自动跳过）。
- 用户输入时前端立即 `thinking`；回复结束后由契约 mood 接管，4s 脉冲回 `idle`。

---

## 3. 数据库表（SCHEMA_VERSION 24）

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `adoptions` | `hunger_level`（默认 50）、`happiness`、`last_interacted_at`、`chat_count` | 养成状态；饥饿度离线衰减结算落点 |
| `pet_play_logs` | `user_id` / `adoption_id` / `user_input` / `pet_reply` / `emotion` / `action` + **v24**：`kind` / `source` / `duration_ms` / `tokens_used` | 交互与调用日志（成本核算） |
| `user_items` | `item_key` / `source='pet_play'` | 背包（COUNT(*) 聚合数量，一件一行） |
| `points_log` | `reason='pet_play' / 'pet_play_refund' / 'pet_play_buy' / 'pet_movie_feed'` | 积分流水（退款负负相抵） |

**`pet_play_logs.kind` 三值**（每日免费计数与日上限口径的核心）：
- `chat`：AI 成功出文的对话（**每日免费 5 次与日上限 100 次都只计本类**，`created_at::date = CURRENT_DATE`）；
- `chat_refund`：AI 全 provider 失败、已退款的兜底对话（不占免费次数）；
- `item`：道具使用记录（需求四.3，不占对话计数）。

`source`：`ai`（模型出文）/ `fallback`（本地兜底）。`duration_ms` / `tokens_used`
（provider 未上报 usage 时按字符 ≈4/token 估算）仅 AI 行非 null。

迁移：`drizzle/0038_pet_play.sql`（基线）+ `drizzle/0039_pet_chat_observability.sql`（v24 四列，
全部 `ADD COLUMN IF NOT EXISTS` 幂等）。生产同步走 client.ts 版本闸门。

---

## 4. 接口说明

### 4.1 `POST /api/pet/chat` · 对话（统一契约）

- 请求：`{ adoptionId, message(1-500), mode? }`（`mode` 为 legacy 兼容参数，忽略——双契约已废除）。
- 防线顺序：JWT `401` → **用户 30/min + IP 60/min 双维限流** `429`（需求六.1）→ 参数校验
  → 输入内容审核 `400` → 归属校验 `403/404` → **离线饥饿结算** → **每日上限 100 `429`
  （code=DAILY_CAP）** → 免费额度判定（当日 `kind='chat'` ≥ 5 → 事务扣 1 积分，不足 `402`
  code=INSUFFICIENT_POINTS）→ `generateThrottled`（并发槽 + 跨 provider 降级；System Prompt
  由 `resolveCharacter(petType).buildSystemPrompt` 构建）→ 失败**自动退款**
  （points_log `pet_play_refund` + 日志 `chat_refund`，需求五.2）→ 输出审核 → 养成推进 + 日志落库。
- 响应：`{ ok, text, mood, intensity, action, points, freeRemaining, happiness, hungerLevel, hungry, source }`
  （`hungry` = hungerLevel ≤ 20，前端据此进 hungry 态 + 提示买粮）。

### 4.2 `GET /api/pet/play?adoptionId=` · 互动页初始化聚合

宠物（离线结算后的饥饿度）+ `character`（id/displayName/greeting）+ `hungry` 标志 +
积分余额 + `items`（5 件商品目录 + owned 背包数量）。30/min 限流。

### 4.3 `GET /api/pet/movie` · 剧场页初始化聚合

同 4.2 之外：主角 = 最早一只 adoption，**无宠物自动创建打工橘猫**
（`species:persian`，名「阿橘 / OJ」）；额外下发 legacy `interactions`（老客户端兼容）。

### 4.4 `POST /api/pet/play/buy` · 购买道具

事务：行锁余额 → 402 → 扣积分（`pet_play_buy`）→ `user_items` 入库。响应 `{ ok, points, owned }`。

### 4.5 `POST /api/pet/play/use` · 使用道具（喂食/玩耍）

事务：归属校验（带 pet_type）→ **先离线饥饿结算** → FIFO 锁取道具（无库存 `409` ITEM_EMPTY）
→ 删除道具 → 饥饿/心情 clamp 增量 → **写 `pet_play_logs`（kind='item'）**。
响应 `{ ok, itemKey, effect, text, mood, action, hungerLevel, happiness, remaining }`
（`text` = 角色台词库对应情绪随机条——喂食播 eat、玩耍播 happy，前端零文案）。

### 4.6 `POST /api/pet/feed` · legacy 直购互动（保留兼容）

剧场老客户端的直购喂食（kind=food|toy 直接扣积分，无背包概念）。
**新客户端一律走背包（4.4/4.5）**；本路由不删除、不新增功能。

### 4.7 `GET /api/pet/asset?name=` · Rive 资产安全下发

防线：JWT `401` → 30/min `429` → **Referer/Origin 跨站 `403`** → 文件名白名单 `400`
→ 存在性 `404` → 流式输出（`Cache-Control: private, max-age=3600` + `nosniff`）。
`.riv` 存仓库私有目录 `assets/rive/`（**绝不放 `public/`**），浏览器唯一获取通道即本接口。

**上架探测（2026-10-17 收尾）**：`/api/pet/play|movie` 聚合响应附带 `riveAvailable`
（`src/lib/pets/rive-asset-server.ts` 服务端 existsSync + 实例级缓存）；`false` 时前端
pet-stage **零请求直降**静态立绘——不再发注定 404 的鉴权请求（console 红字/toast 噪音消除）。
资产随部署上架后 `riveAvailable=true`，同一代码自动恢复 Rive 渲染链路
（部署文件追踪：next.config `outputFileTracingIncludes` 已覆盖 `assets/rive` → 三条 pet 路由）。

---

## 5. 计费与免费额度（需求五）

| 规则 | 口径 |
| --- | --- |
| 每日免费对话 | **5 句**（`PET_CHAT_FREE_DAILY`；当日 `pet_play_logs` 中 `kind='chat'` 行数 < 5 不计费） |
| 超出后 | 每句 **1 积分**（`PLAY_CHAT_COST`），事务扣除 + `points_log('pet_play')` |
| 余额不足 | `402` + `INSUFFICIENT_POINTS` → 前端**充值引导弹窗**（去充值 /pay、去签到 /checkin；不再静默 toast） |
| AI 失败退款 | 全 provider 抛错 → 本地兜底回复 + **积分自动退回**（`pet_play_refund`）+ 日志 `chat_refund` 不占免费次数 |
| 每日总上限 | **100 句/用户**（`PET_CHAT_DAILY_CAP`；超出 `429` + `DAILY_CAP`） |
| 单条长度 | 500 字（`PET_CHAT_MAX_LEN`） |

免费次数计数在扣费前完成（并发下两句同时判定为免费是接受的——经济主约束是日上限与限流）。

---

## 6. 资源部署路径与 Rive 状态机约定（需求二、三）

| 项 | 约定 |
| --- | --- |
| 资产文件 | `assets/rive/worker-cat.riv`（私有目录；缺席时前端自动降级物种头像 + CSS 情绪动画） |
| 下发通道 | `GET /api/pet/asset?name=worker-cat`（JWT + 限流 + Referer 校验 + 白名单 + 流式） |
| 状态机名称 | **`PetStateMachine`** |
| 输入 1 | **Number `emotion`**：情绪索引 0-6，顺序 = `PET_MOODS`（`0=idle 1=happy 2=sad 3=angry 4=hungry 5=thinking 6=sleepy`） |
| 输入 2 | **Number `intensity`**：情绪强度 0-2（可选；资产未做前端自动跳过） |
| 输入 3 | **Trigger（与动作同名）**：`idle / eat / sleep / think / wave / happy / sad / angry / rub`，`fire()` 播放一次性动作 |

**加载失败兜底链**（需求二.2，不静默失败；仅在 `riveAvailable=true` 但 fetch 真失败时触发）：
`fetch 401/404/网络错` → `console.error('[pet-stage] Rive asset load failed (...)')` 明确原因
→ `onAssetFailed` 回调 → 页面 toast 轻提示（`petPlay.assetFallback`）→ 降级 `LivingPet`
（呼吸/眨眼/摇尾 + 情绪 CSS 类）。**当前 `worker-cat.riv` 尚未上架**（二进制资产无法由代码生成）：
聚合响应 `riveAvailable=false` → 前端**零请求直降**静态立绘（无 404/console 红字/toast，
仅一条 info 级透明日志），功能完整可用；放入真实 `.riv` 重新部署后自动切换 Rive 渲染，无需改代码。

---

## 7. 沉浸式体验与埋点（需求七、八）

- **主站 chrome**：`[locale]/layout.tsx` 按 middleware `x-pathname` 判定
  （`/pet-movie`、`/pets/my/[id]/play`）隐藏 SiteHeader / Footer / 客服按钮 / 签到弹窗；
  页内迷你工具条接管：← 返回、🔊/🔇 静音开关、⏻ 退出沉浸。
- **音效**：`src/lib/pet-sound.ts`（WebAudio 振荡器短音：send/reply/feed/buy；零素材）；
  静音开关 `localStorage: aiabw_pet_mute` 持久化。
- **空状态**：play 页宠物 404 → 领养引导卡片（跳 `/pets/adopt`）；movie 页自动创建橘猫无空态。
- **异常状态**：接口失败 toast、资源失败 toast（assetFallback）、402 充值弹窗、429 日上限提示。
- **埋点**：`src/lib/pet-track.ts`（GA gtag + 百度 _hmt 双通道，脚本缺席静默）——
  `pet_page_view / pet_chat_send / pet_feed_click / pet_item_buy / pet_page_exit`
  （退出 = visibilitychange hidden + beforeunload 双保险，只发一次）。

---

## 8. 成本与风控（需求六）

| 项 | 实现 |
| --- | --- |
| 限流 | `/api/pet/chat`：**用户 30/min（petPlay）+ IP 60/min（petChatIp，x-forwarded-for 首跳）**；单实例口径（serverless 各实例独立，削峰足够；精确全局限流可平替 Redis，接口不变） |
| 输入约束 | 单条 500 字；输入/输出双向 `moderateText` 内容审核 |
| 每日总量 | 100 句/用户封顶（`DAILY_CAP` 429） |
| 调用日志 | `pet_play_logs`：user_id、duration_ms、tokens_used（未上报按 ≈4 字符/token 估算）、source（ai/fallback）、provider 经 llm-fallback attempts 记 console |
| 成本查看 | SQL：`SELECT date(created_at), COUNT(*) FILTER (WHERE kind='chat'), SUM(tokens_used), AVG(duration_ms) FROM pet_play_logs GROUP BY 1 ORDER BY 1 DESC` |

---

## 9. 已知风险

1. **`worker-cat.riv` 未上架**：Rive 路径从未在生产真正渲染——状态机输入契约（emotion/intensity/Trigger）
   由契约测试锁定但未经真实资产验证；美术交付后需真机回归。未上架期间前端经 `riveAvailable=false`
   零请求直降静态立绘（2026-10-17 收尾：404/console 红字/toast 噪音已消除），无阻塞；
   上架动作 = 提交 `.riv` 到 `assets/rive/` 重新部署（文件追踪已备，自动切换，无需改代码）。
2. **限流为单实例口径**：serverless 多实例下整体限额 ≈ N×limit（Vercel hobby 冷启动实例数少，
   削峰足够）；IP 维限流对共享出口（校园/公司 NAT）可能误伤，阈值 60/min 已留余量。
3. **免费计数并发窗口**：同一毫秒内的并发请求可能都按"免费"放行（超出 1-2 句），
   日上限 100 是硬兜底，经济影响可忽略。
4. **token 估算偏差**：部分 provider 不上报 usage 时按字符估算（≈4 字符/token），
   成本核算存在 ±20% 级误差；以 provider 后台账单为准。
5. **离线衰减结算点**：只在 play/movie/chat/use 四入口结算（读路径懒结算），
   用户长期不打开页面不衰减（无独立 cron——小时粒度下打开即结清，无感知差异）。
6. **退款失败窗口**：退款事务自身失败仅 console.error（积分极小金额，admin 可经 points_log 审计补）。

---

## 10. 测试与部署

- 契约测试：`tests/pet-characters.test.mjs`（11 项，角色注册表/解析/契约/映射表）、
  `tests/pet-play.test.mjs`（18 项）、`tests/pet-movie.test.mjs`（8 项）。
- 部署：**SCHEMA_VERSION 23 → 24**，推送上线后必须按 ops-rules 手动跑
  `node --experimental-loader ./tests/_paths-loader.mjs scripts/db-migrate-prod.mjs`
  （建议 `Start-Process` 后台跑，防工具 30s 超时连坐杀进程 → `_schema_meta.version=-1` 死锁），
  确认输出 `schema synced to version 24` 再跑 smoke。
- 本地验证：`npx tsc --noEmit` + `npm run build`（注：依赖安装必须 pnpm）。

_创建：2026-10-11 · 宠物剧场 /pet-movie（打工橘猫 · 毒舌涨薪人设）。
重构：2026-10-17 · Phase 12 AI 宠物模块框架性修复（九需求闭环：角色/契约/背包/计费/风控/沉浸/埋点）。_
