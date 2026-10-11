# 灵宠物种头像 · 设计规范与构建（2026-10 视觉重设）

> 26 个 pet_dictionary 物种的统一圆形头像。**本目录 SVG 是唯一设计源**，
> `public/avatars/*.png` 是构建产物（改动 SVG 后必须重跑构建）。

## 视觉规范（契约测试锁定，禁止偏离）

| 项 | 规范 |
| --- | --- |
| 画风 | 扁平矢量（Flat Vector Art）：纯色色块 + 同色深色细节线；**禁止**渐变（linearGradient/radialGradient）、滤镜（filter/feGaussianBlur）、噪点、写实光影 |
| 画布 | 512×512 viewBox；圆形底 `cx=256 cy=256 r=246`，圆外透明（PNG 保留 alpha） |
| 背景 | 圆内浅色系纯色（奶白 #FFF9F0 / 淡蓝 #F0F8FF / 淡青 #F0FAF0 等），**禁止深色底** |
| 构图 | 主体（头部/上半身）居中，占圆内 ≥80%，禁止缩小 |
| 配色 | 每物种一个高饱和主色 + 白色/深色辅色，与浅底强反差；眼/鼻/嘴统一深棕 #3E2A20 系 |
| 统一元素 | 圆眼 + 左上白色高光点；微笑弧线；部分物种淡粉腮红（治愈感系列语言） |

## 物种识别锚点（一眼认出）

企鹅=白肚皮+橙嘴+冰块 / 猎豹=明黄+黑泪痕+斑点 / 刺猬=深褐尖刺+浅脸 / 章鱼=紫圆头+卷触手 /
陆龟=绿壳六边纹+黄皮肤 / 蓝鲸=深蓝白腹+喷水+水波纹 / 小熊猫=红棕+白耳缘+泪纹 /
大熊猫=白脸+黑眼圈+黑耳 / 哈士奇=灰白面具+冰蓝眼 / 边牧=黑白中分 / 柯基=大立耳 /
金毛=垂耳+吐舌 / 缅因猫=耳尖簇毛+鬃领 / 波斯猫=奶油白扁脸+铜眼 / 雪豹=灰白玫瑰斑 /
狮子=深棕鬃毛 / 老虎=橘底黑条纹 / 海豚=蓝灰微笑+背鳍 / 海獭=棕+捧贝壳 /
小丑鱼=橙+三白纹黑边 / 白头海雕=白头+黄钩喙 / 猫头鹰=双大黄眼+耳羽 / 鹦鹉=绿+橙红钩喙 /
亚洲象=大耳+长鼻卷 / 变色龙=眼塔+卷尾+背冠 / 松鼠=大尾巴+抱橡果+门牙

整体效果预览见 `preview.png`（26 格拼贴，由 scripts/build-avatars.mjs 同类 sharp 流程生成，可随设计迭代重新拼）。

## 构建

```powershell
node scripts/build-avatars.mjs   # assets/avatars/*.svg → public/avatars/{id}.png（sharp，512×512 RGBA）
```

## 接线

- 映射：`src/lib/species-avatars.ts`（`SPECIES_AVATARS` + `speciesAvatarFor`）
- 读路径派生：`/api/pets/catalog`（图鉴 + 我的灵宠）、`/api/pets/claim`（领养响应）
  命中映射即覆盖 `imageUrl`；未命中（UGC / 幻想灵宠）回退 DB 原图（`pets.image_url` 个性化
  AI 图保留作详情页/链上藏品用途，零 DB 迁移）。
- 契约测试：`tests/species-avatars.test.mjs`（26 覆盖完整性 / PNG 尺寸与 alpha / 扁平规范锁）。

## 合规说明

SVG 为项目内手工编写的原创矢量图形（非第三方素材、非 AI 位图生成），与
`public/images/pets/GENERATION-NOTES.md` 留档的个性化 AI 图是两套独立资产。
