# 术语约定（Terminology Charter）

> 版本：v1 · 2026-10-06（功能融合度诊断报告 · 建议 3 落地）
> 约束范围：**所有面向用户的文案**（i18n、导航、SEO、法律文本）与**新增代码注释/文档**。
> 代码内既有的函数名/组件名/路由名保持向后兼容，不在本版强制更名。

## 一、核心术语表

| 术语 | 指向实体 | 禁用场景 |
| --- | --- | --- |
| 宠物 / Pet | 经典线 `adoptions`、`pets`（pet_dictionary 物种） | 不用于指代 `aibi_tokens` |
| 艾比 / Aibi | 仅 `aibi_tokens` 资产 | 品牌语境可用（见 §二）；资产语境不可与「宠物」混用 |
| 灵魂卡 / Soul Card | 仅 `soul_cards`（经典宠物一宠一卡的链上凭证） | 不用于指代 `aibi_tokens` 铸造产物（后者叫「艾比凭证 / Aibi credential」） |
| 藏品 / NFR | `digital_collectibles` + `user_collectibles` | 中文正式名：**数字藏品**；盲盒产出物，非同质化 |
| 融合 / Fuse | `aibi fuse`（艾比融合）与 `pets synthesize`（宠物 3 合 1）统一用此词 | 弃用「合成 / Synthesize」 |

## 二、「艾比 / Aibi」双轨语义说明

「艾比」存在两个合法语义层级，写作时按下表判断：

1. **品牌语境**（可用）：指平台整体或全部虚拟生命体的统称。
   - 例：品牌名「艾比世界 / AIABW」、`pages.aboutBody`、`about.abiDefinition`
     （「艾比是艾比世界对平台内所有虚拟宠物的统称」为品牌定义句，保留不改）。
2. **资产语境**（严格）：指 `aibi_tokens` 表中的具体链上资产。
   - 此时「艾比」≠「宠物」：宠物是经典线（adoptions），艾比凭证是 Aibi 线（aibi_tokens）。
   - 铸造 `aibi_tokens` 的产物叫「艾比凭证 / Aibi credential」，**不得**叫「灵魂卡」。
   - 新增资产语境文案时，禁止用「艾比」指代经典线宠物（反之亦然）。

## 三、同义玩法命名统一

| 玩法 | 数据表 | 统一术语 | 弃用 |
| --- | --- | --- | --- |
| 宠物 3 合 1 升档 | `adoptions`（/pets/my） | 融合 / Fuse | 合成 / Synthesize |
| 艾比 2~5 合 1 | `aibi_tokens`（/bag） | 融合 / Fuse | —（原本即融合） |

- 代码标识符（`synthesize`、`pets.synthesize` i18n key、`SynthesizeModal` 等）保持原名，仅改显示文案。
- 法律文本（terms/privacy/goods）与 UI 同步统一为「融合 / Fusion」，不再并列「合成与融合」。

## 四、首批执行记录（2026-10-06）

- 导航：`nav.navAdoptMy` 领养/我的艾比→领养/我的宠物（Adopt / My Aibi→Adopt / My Pets）；
  `nav.navSoulCodex` 灵魂卡/图鉴→灵魂卡/收藏（Soul Cards / Codex→Soul Cards / Collection）；
  `nav.codex` 图鉴→艾比图鉴（Codex→Aibi Codex，「更多」内位置不变）。
- Aibi spotlight 副标题：铸造灵魂卡→铸造艾比凭证（mint Soul Cards→mint Aibi credentials）。
- FAQ（pages.faqBody）：「先领养第一只艾比 / Adopt your first Aibi」→「先领养第一只宠物 / Adopt your first pet」（指经典线）。
- 「合成」→「融合」：home.rareBannerSub、pets.synthesize\*、pets.loginFirst、petsCatalog（onlyEvolvable/noEvolvable/selectTitle/selectHint/fuseNow/continueFuse）、legal 三文书。
- 互跳条：/pets/my 新增 → /my-pets 引导（petsCatalog.crossBanner/crossGo）；/my-pets → /pets/my 已有 evolveBanner（myPets 命名空间，文案本即用「融合」）。
