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

## 六、第三批执行记录（2026-10-09 · /my-pets 与 /pets/my 双页合并）

- 背景：backlog P2（2026-10-06 功能融合度诊断 #5）。/my-pets（聊天伙伴：心情/记忆/背包/装扮/邀请）与 /pets/my（收藏资产：持有管理/融合/兑换/放生）数据源同为 adoptions、职责割裂，用户需在两个「我的宠物」间来回；互跳条（myPets.evolveBanner ↔ petsCatalog.crossBanner）只缓解未治本。
- 方案：以 /pets/my 为统一入口，单页双 Tab —— 💞 伙伴（companion-panel.tsx，原 /my-pets 整体迁入）/ 🎒 收藏（collection-panel.tsx，原 /pets/my 整体迁入）；面板懒挂载 + hidden 状态保留（切换不重新请求）；未登录跳转上移至 Tab 壳。
- URL：/my-pets → 308 永久重定向至 /pets/my（与 /explore → /explore-v2 同模式，兼容旧书签/外链/收录）；深链 ?tab=collection 直达收藏，?rarity=（图鉴稀有度筛选历史入口）自动切收藏 Tab。
- 引用统一：SiteHeader moreItems、sitemap（只列终态 URL）、points/handbooks/marketplace 页 Link、首页登录回跳 redirect 全部指向 /pets/my。
- i18n：新增 myPets.tabCompanion/tabCollection（双语）；删除互跳条四键（myPets.evolveBanner/evolveGo、petsCatalog.crossBanner/crossGo）。
- 契约测试：tests/my-pets-merge.test.mjs（6 项）；soul-pet.test.mjs #10 URL 锁修订（四路由原位 → /pets /pets/my /pets/[id] 原位 + /my-pets 308 保留）；aibi-names.test.mjs displayName 断言改指 companion-panel。
## 七、第四批执行记录（2026-10-15 · 内容 review 收敛）

- 背景：上线前内容 review，与 P0 概念收敛（2026-10-14，/soul-cards 双 Tab 收藏中心）口径对齐。
- 导航：`nav.navSoulCodex` 灵魂卡/收藏→收藏（Soul Cards / Collection→Collection）——收藏中心页内已是「灵魂卡/藏品」双 Tab，导航标签不再重复「灵魂卡」；「我的灵宠」撞名锁不受影响（tests/soul-pet.test.mjs #7 断言同步）。
- 导航结构确认：`/packs`（卡包商店，停售）与 `/bag`（背包/融合，融合停用）已在 SiteHeader `moreItems`「更多」下拉（P0 已降级），一级导航维持 4 项：我的灵宠 → 收藏 → 盲盒广场 → 探索。
- 首页 spotlight：`aibi.spotlight.entryPacksDesc` 开包获得新艾比→开包获得新灵宠（Open packs for new aibis→soul pets）。
- 页面 title/SEO/OG：`aibi.spotlight.title` + `common.metaDescription` + `OG_ALT`/`OG_SHARE_ALT`（og-share-image.tsx / site.ts）「AI 角色养成与数字收藏（平台）」→「AI 灵魂养成与数字凭证（平台）」（en：companion-raising & digital collectibles→soul-raising & digital credentials）。
- 残留词扫描确认：mint/链上/NFT/合约/钱包地址 在用户-facing 文案（messages/*.json 值）零残留——zh 已统一「发行/登记地址/记录指纹」，en 已统一 "Issued"；命中处均为 contracts/ 合约工程、docs/ 技术文档、代码注释与运维清单（非用户-facing，保留）。
- 契约测试：locale-routes.test.mjs navSoulCodex 断言同步；verify-locale-sync.mjs zhMust「灵魂卡/收藏」→「数字凭证」（新 title 词）。

