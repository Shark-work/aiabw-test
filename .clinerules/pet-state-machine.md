# 通用宠物状态机 + 物种换皮（宠物互动系统架构红线）

> 适用场景：改宠物互动页（play/movie）、加新物种、改 Rive 资产/动画契约、改对话意图解析。

## 分层（单一事实源，越层 import 即事故）

| 层 | 模块 | 职责 | 客户端可 import？ |
| --- | --- | --- | --- |
| 动画契约 | `src/lib/pets/sm-contract.ts` | PET_MOODS(7)/PET_ACTIONS/MOOD_ACTION_MAP/PET_SM_TRIGGERS(5)/ACTION_TRIGGER_ALIAS/inferMood/PetChatReply | ✅ 纯数据纯函数 |
| 物种视觉 | `src/lib/pets/species-visuals.ts` | 注册表：speciesId → rivePath/立绘/场景主题 | ✅ 纯数据 |
| 角色人设 | `src/lib/pets/characters.ts` | 人设/台词库/buildSystemPrompt/fallbackPetReply | ❌ 服务端专用（prompt 零进 bundle） |
| 对话驱动 | `src/lib/pets/intent-resolver.ts` | 关键词→LLM 严格契约 5s→降级链；养成状态修正 | ❌ 服务端专用 |
| 舞台渲染 | `src/components/pet-play/pet-stage.tsx` | Rive 双模 + CSS 降级 + Trigger/Number 输入绑定 | 客户端组件 |
| 对话气泡 | `src/components/pet-play/chat-bubble.tsx` | 单轮打字机 + 淡入 + 打字状态上报发送锁 | 客户端组件 |

- 契约常量与视觉解耦：动画逻辑（怎么动）只在 sm-contract；物种外观（长什么样）只在 species-visuals。
- `characters.ts` 与 `pet-play-config.ts` 只是 re-export 口（既有 import 兼容），不加新逻辑。

## Rive 状态机契约 v2（美术交付红线，详见 assets/rive/README.md）

- 状态机名固定 `PetStateMachine`；Number 输入 `emotion` = PET_MOODS 索引（0-6）；
  Number 输入 `intensity` = 0-1 连续小数；Trigger 输入 = pet/eat/play/sleep/wake（大小写严格）；
  每个 Trigger 播完自动回 idle；文件必须 `.riv`（非 .rev）。
- 契约资产缺输入 → pet-stage console.error 明确报错（不静默）；素材资产（无契约 SM）
  → 二进制探测自适应 autoplay，输入绑定挂起属正常。
- LLM 对话契约：`{ intent, emotion, intensity, reply }`（角色 prompt 的 contractSection 注入；
  动作名不进 prompt——动作由服务端 MOOD_ACTION_MAP 推导）。

## ➕ 新增物种（只需注册表加一条）

1. `species-visuals.ts` 的 SPECIES_VISUALS 加一条：
   `{ speciesId, rivePath（可空 = 纯立绘）, staticImage, sceneTheme }`；
2. globals.css 加 `.pet-scene-<sceneTheme>` 氛围类（仅新主题需要）；
3. 头像派生走 species-avatars 既有管线；人设特殊时才在 characters.ts 加角色
   （否则自动落兜底角色艾比灵宠，文案零错配）；
4. Rive 素材放 `assets/rive/<rivePath>.riv`（.gitignore 白名单只放行契约名——
   新素材需同步加白名单行）；未上架 → 服务端 existsSync 探测零请求直降立绘，无 404 噪音；
5. 完：动画契约/驱动层/气泡/埋点全自动生效，无需动 pet-stage / intent-resolver。

## 可观测

- /api/pet/chat 每句落 pet_play_logs（kind=chat，source=keyword/llm/fallback，
  duration_ms/tokens_used，action 记录意图）；
- console.info 结构化日志 `[pet/chat] intent=… emotion=… source=… llmMs=… tokens=…`；
- /api/admin/ai-stats → petChat（7 日三来源分布 / keywordRate 零成本占比 / 意图分布），
  /console/moderation AI 成本条展示（2026-10-18 自研后台 /admin → /console）。

## 测试锁定

- `tests/pet-species-visuals.test.mjs`：注册表/解耦锁/README 契约 v2 文档锁；
- `tests/pet-intent-resolver.test.mjs`：解析链/降级/状态修正/路由接线/ai-stats 观测/本文档锁；
- `tests/pet-characters.test.mjs`：prompt 契约 v2/客户端零 characters import；
- `tests/pet-play.test.mjs`：pet-stage 绑定/报错门控/reduced-motion/气泡发送锁。
