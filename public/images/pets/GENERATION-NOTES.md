# 宠物插画生成记录（合规留档）

> 本文件用于记录 `public/images/pets/*.webp` 的生成来源，证明其为 AI 生成原创资产，
> 非直接盗用任何第三方作品，可配合《用户服务协议》原创声明使用。

## 生成概览
- **数量**：100 张（100/100 成功，0 失败）
- **生成方式**：AI 生成（Pollinations.ai 免费文本生图服务，无需 API Key）
- **生成脚本**：`scripts/generate-pet-images.cjs`
- **生成时间**：2026-08（上线前批量生成）

## 生成原理
1. **唯一提示词**：每个宠物按 `物种（英文）+ 元素（fire/water/earth/air）+ 稀有度视觉词` 构造独立 prompt，
   例如 common 为「simple, minimal, flat colors」、legendary 为「radiant golden aura, ...」。
2. **确定性 seed**：`seed = hash(petId)`（宠物 ID 为唯一哈希），保证每张图唯一且可复现。
3. **无版权干扰参数**：URL 追加 `nologo=true`，prompt 末尾固定 `no text`，避免品牌/文字水印污染。
4. **失败兜底**：单张失败重试 3 次；仍失败则保留占位图不阻断整体流程。

## API 请求格式
```
https://image.pollinations.ai/prompt/{encodedPrompt}?seed={hash(petId)}&nologo=true&width=512&height=512
```

## 产出位置
- `public/images/pets/{petId去掉#}.webp`（512×512，打包进仓库，不依赖外部图床）
- `pets.image_url` 同步更新为 `/images/pets/{hash}.webp`

## 合规说明
- 所有画面均由 AI 依据文字描述生成，属于平台自行创作的原创美术资产；
- 若后续商用对外授权，建议保留本记录 + 脚本 prompt 模板作为来源凭证；
- 页面渲染时已叠加半透明「© 艾比世界」水印（`src/components/pets/pet-watermark.tsx`）防止截图盗用。
