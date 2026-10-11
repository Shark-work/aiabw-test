# Rive 动画资产目录（私有 · 非 public）

> 防抄袭红线：**`.riv` 文件绝不放 `public/` 目录**。本目录是唯一的资产存放点，
> 浏览器唯一获取通道是 `GET /api/pet/asset?name=<asset>`（JWT 鉴权 + 30/min 限流 +
> 文件名白名单 + 后端流式输出），无公开可盗链 URL。

## 当前资产契约

| 资产名 | 文件 | 用途 |
| --- | --- | --- |
| `worker-cat` | `assets/rive/worker-cat.riv` | 互动页舞台宠物（打工橘猫） |

⚠️ `worker-cat.riv` 尚未上架（二进制资产无法由代码生成）。资产缺席时前端
自动降级为物种头像 + CSS 情绪动画（`pet-stage.tsx`），功能完整可用；
放入真实 `.riv` 后自动切换 Rive 渲染，无需改代码。

## .riv 制作约定（美术 / Rive Editor 交付需遵守）

- 画布：建议 1024×1024，透明背景，主角居中偏下（舞台 `h-[46vh]` 正方形容器）。
- 状态机名称：**`PetStateMachine`**（`src/lib/pet-play-config.ts` 的 `RIVE_STATE_MACHINE`）。
- 输入 1 — Number 类型，名称 **`emotion`**：情绪索引，取值 0-5，顺序即
  `PLAY_EMOTIONS` 白名单：`0=idle 1=happy 2=sad 3=angry 4=eating 5=thinking`。
  状态机应按值切换对应表情/待机动画。
- 输入 2 — Trigger 类型，与动作同名（`PLAY_ACTIONS` 白名单）：
  `idle / happy / sad / angry / eat / sleep / think / wave`，fire 后播放一次性动作。
- 合规：原创或 Rive Community 可商用授权素材二次制作；交付前在 PR 描述注明来源与授权。
