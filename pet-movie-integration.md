# 宠物剧场（/pet-movie）集成文档

> 电影式 AI 宠物互动子模块：主站 Header/Footer 保留的沉浸式电影舞台——
> Rive 宠物居中 + 打字机字幕 + 右缘 5% 热区滑出背包 + 底部对话输入框。
> 本文档：路由结构 / 数据库表结构 / API 接口说明 / Rive 状态机命名规范 / 安全措施生效位置。

---

## 1. 路由结构

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 页面 | `src/app/[locale]/pet-movie/page.tsx` | SSR 壳 + `generateMetadata`（noindex 私有互动页） |
| 客户端 | `src/components/pet-movie/pet-movie-client.tsx` | 舞台状态机（mood/action/打字机/侧栏/输入） |
| URL | `/pet-movie` → middleware 自动补 locale 前缀 → **`/zh/pet-movie`、`/en/pet-movie`** | next-intl 规范（与全站一致，无字面 `/pet-movie` 路由文件） |
| Header/Footer | `src/app/[locale]/layout.tsx`（全局自带 `SiteHeader` + `Footer`） | 舞台是主站内容区内的深色沉浸容器，主站 chrome 一致 |
| 导航入口 | `src/components/layout/SiteHeader.tsx` `moreItems`「🎬 宠物剧场」 | i18n `nav.navPetMovie` |

**舞台六区块（需求一.2 布局契约，测试锁定）**：

| 区块 | 实现 | 关键类名 |
| --- | --- | --- |
| `<Stage>` | 全局深色背景 / 隐藏滚动 / 禁止选中 | `relative h-[calc(100dvh-220px)] min-h-[560px] overflow-hidden bg-[#121212] select-none`（高度扣除 Header/Footer） |
| `<Navbar>` | 顶部状态条：宠物名 + Lv + 🍗 饥饿度进度条 + ❤️ 心情 + 🪙 积分 | `absolute top-0 left-0 w-full z-20` |
| `<PetContainer>` | 中央舞台：Rive 优先，资产缺席降级 CSS 动画立绘（`pet-stage.tsx` 双模复用） | `absolute inset-0 flex items-center justify-center z-10` |
| `<Subtitle>` | 底部字幕：打字机逐字（`use-typewriter.ts`），默认隐藏、说话时显示 | `absolute bottom-[120px] text-white text-lg` + `text-shadow` |
| `<Sidebar>` | 右侧悬浮背包：**右缘 5% 热区**悬停滑出；🐟 猫粮 / 🧸 玩具一键互动 | 热区 `w-[5%]`；侧栏 `absolute top-[20%] right-0 w-[80px] h-[60%] bg-black/40 backdrop-blur-md`，`translate-x-full ↔ translate-x-0` |
| `<ChatInput>` | 底部输入框：半透明圆角长条 + 发送按钮 | `absolute bottom-[30px] left-1/2 -translate-x-1/2 w-[60%] max-w-[800px]` |

---

## 2. 数据库表结构（需求三落点）

**核心决策：零 schema 变更（SCHEMA_VERSION 保持 23），需求表名映射到既有表。**

| 需求表 | 实际落点 | 原因 |
| --- | --- | --- |
| `pets`（宠物状态） | **`adoptions`** | 项目已存在 `pets` 表（灵魂卡/收藏系统，`src/db/schema.ts:265`，`speciesId → petDictionary`）——新建同名表直接撞表。`adoptions` 自 drizzle/0038 起具备全部所需字段 |
| `pet_interactions`（互动流水） | **`pet_play_logs`** | drizzle/0038 已建，字段与需求全对齐并扩展（见下）；避免双真相源 |

**字段对照**：

| 需求字段 | 实际列 | 说明 |
| --- | --- | --- |
| pets.id | `adoptions.id` (uuid) | 主键 |
| pets.user_id | `adoptions.user_id` (text) | 归属 |
| pets.name | `adoptions.pet_name` | 剧场主角名 |
| pets.hunger | `adoptions.hunger_level` (int 0-100, 默认 50) | 喂食 +N / 对话自然消耗 |
| pets.mood | `adoptions.happiness` (int 0-100) | 心情值 |
| — | `adoptions.last_interacted_at` | 最近互动时间 |
| pet_interactions.id | `pet_play_logs.id` (uuid) | 主键 |
| pet_interactions.user_id | `pet_play_logs.user_id` (uuid → users) | 外键 |
| pet_interactions.user_input | `pet_play_logs.user_input` (text) | 用户输入 |
| pet_interactions.pet_reply | `pet_play_logs.pet_reply` (text) | 宠物回复 |
| pet_interactions.created_at | `pet_play_logs.created_at` (timestamp) | 时间戳 |
| （扩展） | `pet_play_logs.adoption_id` / `emotion` / `action` | 宠物维度历史 + Rive 驱动标签审计（值域由应用层白名单约束） |

**默认宠物**：无 adoption 的用户首次进入剧场，由 `GET /api/pet/movie` 自动创建打工橘猫
（`pet_type = species:persian`，名字按 locale「阿橘 / OJ」）。
> 为什么不是 `'cat'`：官方 `PetType` 仅 fox/penguin/dog（`src/lib/pet-config.ts`），
> `getPet('cat')` 会 fallback 成狐狸头像；图鉴猫科物种（AIBI id `persian`）走
> `speciesAvatarFor('persian')` 派生手绘头像 `/avatars/persian.png`。

---


## 3. API 接口说明（需求二）

全部接口：JWT Bearer 鉴权（`getUserFromRequest`）+ 内存固定窗口限流（429 + `Retry-After`）+ i18n 错误文案。
**防抄袭红线：状态判断 / 大模型调用 / 积分扣除 / 数值结算 100% 在服务端完成，客户端零密钥、零 System Prompt、零经济参数。**

### 3.1 `POST /api/pet/chat` · 剧场对话（需求二.1/2.2）

在既有互动屋路由上扩展 **`mode: "movie"`** 剧场契约（`mode` 缺省 = 互动屋 `{reply, emotion, action}`，向后兼容，`/pets/my/[id]/play` 零影响）。

- 请求：`{ "adoptionId": "<uuid>", "message": "1-500 字", "mode": "movie" }`
- 响应：`{ "ok": true, "text": "回复文本", "mood": "bored|happy|sad|hungry", "action": "idle|eat|jump", "points": 94, "happiness": 51, "hungerLevel": 49, "source": "ai|fallback" }`
- 错误：`401` 未登录 / `429` 限流（30/min）/ `400` 参数或输入审核 / `402` 积分不足 / `403` 非本人宠物 / `404` 宠物不存在
- 服务端流程：鉴权 → 限流 → 参数校验 → **输入内容审核** → 归属校验 → **事务扣 1 积分**（`points_log reason='pet_play'`)
  → `generateThrottled`（并发槽 + 跨 provider 降级链；System Prompt = 嘴硬/摸鱼/毒舌/渴望涨薪 四要素，
  `buildMovieCatPrompt`，密钥仅服务端环境变量）→ **输出内容审核** → 写 `pet_play_logs`
  （`emotion/action` 经映射落库）+ 养成状态推进（心情 +1 / 饥饿 −1）→ 统一契约返回。
- **AI 全挂时自动切本地兜底**（`fallbackMovieReply`，关键词推断 + 人设语录库），契约字段永远在，功能永可用。
- mood/action 值域由 `MOVIE_MOODS` / `MOVIE_ACTIONS` 白名单归一（越界 → bored/idle）。

### 3.2 `GET /api/pet/movie` · 剧场初始化聚合

- 响应：`{ "ok": true, "pet": { "id", "name", "petType", "avatar", "happiness", "hungerLevel", "level" }, "points": 100, "interactions": [ { "kind": "food", "emoji": "🐟", "cost": 5, "hungerDelta": 25, "happinessDelta": 3 }, { "kind": "toy", ... } ] }`
- 宠物解析：用户最早一只 adoption；**无则自动创建打工橘猫**（见 §2 默认宠物）。
- 侧栏互动的价格/数值全部由本接口下发，前端不硬编码经济参数。

### 3.3 `POST /api/pet/feed` · 侧栏一键互动（需求二.3）

- 请求：`{ "adoptionId": "<uuid>", "kind": "food" | "toy" }`
- 响应：`{ "ok": true, "kind": "food", "points": 95, "hungerLevel": 75, "happiness": 53 }`
- 事务（与 `/api/pet/play/use` 同模式）：归属校验 → `SELECT ... FOR UPDATE` 锁余额 → 不足 `402`
  → 扣积分 + `points_log reason='pet_movie_feed'` → `adoptions` 饥饿度/心情 SQL 内 clamp(0-100) 结算 → COMMIT。
- 配置（`MOVIE_INTERACTIONS`，改常量即生效无需迁移）：🐟 猫粮 5 积分 +25 饥饿/+3 心情；🧸 玩具 8 积分 +20 心情。
- 前端收到成功后触发 Rive **eat**（猫粮）/ **jump**（玩具）动作并更新顶部状态条。

### 3.4 `GET /api/pet/asset?name=worker-cat` · Rive 资产安全下发（需求四.2）

- 防线（依序）：JWT `401` → 限流 30/min `429` → **Referer/Origin 跨站校验 `403`** → 文件名白名单 `400`
  → 存在性 `404` → 流式输出（`Content-Disposition:inline` + `nosniff` + `Cache-Control: private, max-age=3600`）。
- Referer 校验规则：头存在且 host ≠ 本站 → 拒绝；头缺失（隐私模式/直接 fetch）放行（鉴权+限流兜底）。
- `.riv` 存放于仓库私有目录 `assets/rive/`（**绝不放 `public/`**），浏览器唯一获取通道即本接口。

---

## 4. Rive 状态机触发器命名规范（美术 / Rive Editor 交付契约）

| 项 | 约定 |
| --- | --- |
| 资产文件 | `assets/rive/worker-cat.riv`（私有目录；缺席时前端自动降级 CSS 动画立绘，功能完整可用） |
| 状态机名称 | **`PetStateMachine`**（`src/lib/pet-play-config.ts` 的 `RIVE_STATE_MACHINE`） |
| 输入 1 | **Number 类型，名称 `emotion`**：情绪索引 0-5，顺序 = `PLAY_EMOTIONS`：`0=idle 1=happy 2=sad 3=angry 4=eating 5=thinking` |
| 输入 2 | **Trigger 类型，与动作同名**：`idle / happy / sad / angry / eat / sleep / think / wave`，`fire()` 播放一次性动作 |

**剧场值域 → 状态机映射**（`pet-play-config.ts` 的 `movieMoodToEmotion` / `movieActionToAction`，前后端共用）：

| 剧场 mood | emotion 输入 | 剧场 action | Trigger |
| --- | --- | --- | --- |
| bored | 0 (idle) | idle | 不 fire |
| happy | 1 (happy) | eat | `eat` |
| sad | 2 (sad) | jump | `happy` |
| hungry | 4 (eating) | | |

> 完整制作约定（画布/授权/降级策略）见 `assets/rive/README.md`。

---

## 5. 安全措施生效位置（需求四）

| 措施 | 文件 · 位置 |
| --- | --- |
| **业务 100% 服务端化**（防抄袭根基） | `src/app/api/pet/chat|feed|movie/route.ts`：密钥（DEEPSEEK_* 等，经 `llm-fallback` 降级链读取）、System Prompt、扣费、数值结算均在服务端；客户端 bundle 零密钥零 prompt |
| **生产代码混淆** | `next.config.ts` `webpack()`：`!dev && !isServer` 时挂 `webpack-obfuscator`（字符串数组 base64 + 紧凑化保守档；require 失败仅告警不阻断构建） |
| **反 F12 / DevTools** | `src/components/pet-play/use-anti-debug.ts`（窗口尺寸差轮询 → `router.replace("/")` 跳离）+ `use-anti-copy.ts`（F12 / Ctrl⌘+Shift+I/J/C / Ctrl⌘+U / Ctrl⌘+S 快捷键拦截，capture 阶段） |
| **防右键** | `use-anti-copy.ts`：`contextmenu` 事件 `preventDefault` |
| **仅生产生效** | 两个 hook 均 `process.env.NODE_ENV === "production"` 门控，开发零干扰 |
| **_document.tsx 说明** | 本项目为 App Router（无 `_document`），等效注入点 = 客户端 hook（`pet-movie-client.tsx` 挂载处） |
| **Rive 资产防盗链** | `src/app/api/pet/asset/route.ts`：JWT + 限流 + **Referer/Origin 跨站 403** + 白名单 + 目录前缀二次校验 + 流式 + private 缓存；`.riv` 不入 `public/` |
| **限流** | `src/lib/rate-limit.ts`：`petPlay` 30/min（对话+初始化）、`petFeed` 20/min（侧栏互动）、`petAsset` 30/min（资产） |
| **鉴权** | JWT Bearer（`getUserFromRequest`，`src/lib/auth.ts`）；宠物归属逐请求校验 |
| **内容审核** | `moderateText` 输入/输出双向（chat 路由第 4/8 步，命中词表替换为安全兜底文案） |

---

## 6. 测试与部署

- 契约测试：`tests/pet-movie.test.mjs`（布局契约 / API 契约 / 安全红线 / i18n parity / 纯函数单测）。
- 本地验证：
  ```powershell
  node --experimental-loader ./tests/_paths-loader.mjs --test tests/pet-movie.test.mjs
  node --experimental-loader ./tests/_paths-loader.mjs --test tests/*.test.mjs   # 全量回归
  npx tsc --noEmit
  npm run build   # 注：依赖安装必须 pnpm（npm 会因 symlink 结构崩溃）
  ```
- 部署：**零 schema 变更（SCHEMA_VERSION 23 不变），无需跑迁移脚本**；`assets/rive/worker-cat.riv` 上架即自动切换 Rive 渲染，无需改代码。

_创建：2026-10-11 · 宠物剧场 /pet-movie（打工橘猫 · 毒舌涨薪人设）。_
