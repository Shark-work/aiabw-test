# 术语约定（Terminology Charter）

> 版本：v1 · 2026-10-06（功能融合度诊断报告 · 建议 3 落地）
> 约束范围：**所有面向用户的文案**（i18n、导航、SEO、法律文本）与**新增代码注释/文档**。
> 代码内既有的函数名/组件名/路由名保持向后兼容，不在本版强制更名。

## 一、核心术语表

| 术语 | 指向实体 | 禁用场景 |
| --- | --- | --- |
| 宠物 / Pet | 经典线 `adoptions`、`pets`（pet_dictionary 物种） | 不用于指代 `aibi_tokens` |
| 灵宠 / Soul Pet | 经典线宠物的**收藏向产品名**（2026-10-09 升级）：「领养→唤醒灵魂」「我的宠物→我的灵宠」「详情页→灵魂档案」 | 仅 UI/SEO 文案层；数据表/代码标识符仍用 pet；不用于指代 `aibi_tokens` 或 `soul_cards` |
| 灵魂名 / Soul Name | 灵宠展示名：元素前缀 + 艾比名/原型名（`src/lib/soul-pet.ts` 读路径派生，如「水之灵·泡泡」） | 仅页面内展示；SEO title/OG/JSON-LD/sitemap 一律维持原型名（强约束，tests/soul-pet.test.mjs #6 锁定） |
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

## 五、第二批执行记录（2026-10-09 · 「我的灵宠」体系升级）

- 背景：PM 评审认定「领养/我的宠物」与灵魂图鉴收藏叙事割裂，全面升级为「我的灵宠」体系，增强收藏感与资产感。
- 导航：`nav.navAdoptMy` 领养/我的宠物→我的灵宠（Adopt / My Pets→My Soul Pets）；`nav.myPets`/`common.myPets`/`myPets.title` 同步「我的灵宠」。
  - **命名决策**：候选「灵魂卡」「我的收藏」因与既有 `nav.navSoulCodex`（灵魂卡/收藏 → /soul-cards 凭证中心）撞名被否决；「我的灵宠」与灵魂卡（凭证）、艾比（aibi_tokens）构成三层清晰语义（测试 #7 撞名锁）。
- 文案：图鉴「获得它→唤醒灵魂」「已拥有→已唤醒」「领养中→唤醒中」「详情页→灵魂档案」；图鉴标题「宠物图鉴→灵宠图鉴」（petsCatalog.title + nav.catalog + JSON-LD 名称同步）；详情页 SEO「虚拟宠物图鉴→灵宠灵魂档案」。
- 灵魂名：新增 `src/lib/soul-pet.ts`（元素→前缀映射 水/火/地/风之灵 × zh/en，兜底「魂之灵」）；catalog API 双模式新增 `soulName` 字段（speciesName/aibiName 保留，向后兼容，DB 零迁移）。
- 视觉：图鉴卡片未拥有=虚线边框+磨砂淡化（border-dashed + grayscale），已拥有=琥珀高亮+流光扫掠（globals.css soul-card-owned，prefers-reduced-motion 降级）。
- 兼容：全站 URL 零变更（/pets /pets/my /my-pets /pets/[id] 原位）；老用户升级公告一次性 banner（localStorage `aiabw_soul_upgrade_v1` 幂等）。
- 契约测试：tests/soul-pet.test.mjs（13 项）；locale-routes.test.mjs navAdoptMy 断言同步。
