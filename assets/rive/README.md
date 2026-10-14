# Rive 动画资产目录（私有 · 非 public）

> 防抄袭红线：**`.riv` 文件绝不放 `public/` 目录**。本目录是唯一的资产存放点，
> 浏览器唯一获取通道是 `GET /api/pet/asset?name=<asset>`（JWT 鉴权 + 30/min 限流 +
> 文件名白名单 + 后端流式输出），无公开可盗链 URL。

## 当前资产契约

| 资产名 | 文件 | 用途 |
| --- | --- | --- |
| `worker-cat` | `assets/rive/worker-cat.riv` | 互动页舞台宠物（当前 = cat-playing 社区素材占位，61KB） |

**当前状态（2026-10-17 素材占位上架）**：`worker-cat.riv` 为 Rive Community
「cat-playing-animation」素材（状态机 = 默认 `State Machine 1`，**未按下方契约制作**）。
前端 pet-stage 二进制探测资产是否含 `PetStateMachine`：不含 → 省略 `stateMachines`
autoplay 默认动画（emotion/intensity/Trigger 输入绑定挂起）；含 → 契约全绑定。
正式定制资产交付后**同名替换**本文件即恢复全绑定，零代码改动。

**入库白名单**：`.gitignore` 只放行 `assets/rive/worker-cat.riv`，其余 `*.riv` 不入库
（素材源文件留存本地即可——防大体积素材误提交；新契约资产上架 = 同名替换）。

**合规提醒**：素材占位为过渡方案——正式上线前需确认该社区素材授权（rive.app 对应
社区页标注的 License），或替换为原创/已购授权定制资产（推荐，顺带补齐契约状态机）。

## .riv 制作约定（美术 / Rive Editor 交付需遵守）

- 画布：建议 1024×1024，透明背景，主角居中偏下（舞台 `h-[46vh]` 正方形容器）。
- 状态机名称：**`PetStateMachine`**（`src/lib/pets/characters.ts` 的 `RIVE_STATE_MACHINE`）。
- 输入 1 — Number 类型，名称 **`emotion`**：情绪索引，取值 0-6，顺序即
  `PET_MOODS` 白名单：`0=idle 1=happy 2=sad 3=angry 4=hungry 5=thinking 6=sleepy`。
  状态机应按值切换对应表情/待机动画。
- 输入 2 — Number 类型，名称 **`intensity`**（可选）：情绪强度 0-2，
  用于驱动动画幅度（0 弱 / 1 中 / 2 强）；资产未做该输入时前端自动跳过。
- 输入 3 — Trigger 类型，与动作同名（`PET_ACTIONS` 白名单）：
  `idle / happy / sad / angry / eat / sleep / think / wave / rub`，fire 后播放一次性动作；
  `rub` 为「蹭蹭」互动动作（用户点击宠物时触发）。
- 合规：原创或 Rive Community 可商用授权素材二次制作；交付前在 PR 描述注明来源与授权。
