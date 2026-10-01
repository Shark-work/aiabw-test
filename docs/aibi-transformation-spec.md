# AIABW 改造升级 · 执行指令集（链下模拟模式）

> 本文档为「AI 生命体 + 区块链稀缺凭证 + 收集养成」平台改造的**权威需求存档**，
> 由用户于 2026-09-30 完整提供（原 docx：《AIABW改造升级-Cline执行指令集-链下模拟模式.docx》）。
> 后续各阶段执行**以本文档为准**；每阶段完成后在文末「阶段状态总表」更新进度。

---

## 一、全局前置指令

**项目目标**：将现有网站升级为一个「AI 生命体 + 区块链稀缺凭证 + 收集养成」平台。

**核心概念**：
1. 艾比不是普通图片，而是「AI 动态角色卡 / Aibi Soul Card」。
2. 每只艾比都有：名称、稀有度、元素、栖息地、AI 性格、成长状态、链上凭证编号。
3. 艾比数量通过 Mint 增发、Burn 销毁控制。
4. 链上数据控制凭证总量，链下数据库控制业务状态和实物数量。
5. 后续为发币、交易、质押、治理做铺垫，但当前阶段先完成基础架构。

**执行原则**：
1. 先分析现有项目结构，不要直接覆盖或删除现有核心文件。
2. 所有新增功能必须兼容现有网站结构。
3. 数据库变更必须生成可执行的迁移文件。
4. 后端接口必须分层：Controller / Service / Repository。
5. 前端页面必须组件化，不要把所有逻辑写在一个页面里。
6. 区块链部分先做「链下模拟 + 测试网合约结构」，不要一开始接入主网。
7. 每个阶段完成后，必须输出：已完成内容 / 新增修改文件列表 / 当前状态 / 下一步建议。

---

## 二、阶段 1：灵魂卡系统（✅ 已完成）

- **数据层**：soul_cards / chain_ledger / chain_supply 三表（drizzle 迁移，SCHEMA_VERSION=6 生产自动同步；单例供应计数器 + tokenId/凭证号/txHash 唯一约束 + 一宠一卡）。
- **共享配置**：soul-card-config.ts — 5 稀有度 / 4 元素 / 4 成长阶段（seed 1→sprout 10→bloom 30→radiant 60）/ 线性经验（level×100）/ 凭证编号 AIBI-000001。
- **链层（离链模拟，主网未部署）**：ChainProvider 接口 + MockChainProvider（sha256 生成 0x+64hex 哈希、nonce 防重、模拟区块号）+ getChainProvider 工厂（CHAIN_PROVIDER=mock|evm 可切换）+ contracts/AibiSoulCard.sol（ERC-721 + MAX_SUPPLY + MINTER_ROLE + burn + certificateNoOf/soulStateHashOf，README 含 Sepolia 部署步骤）。
- **服务/接口**：mint（事务内原子占号→铸币→记账，SUPPLY_EXHAUSTED 硬顶）、burn（两段确认）、详情（公开凭证 + 流转轨迹）、我的卡册、可铸列表、链状态公开读；8 个业务错误码 → HTTP/i18n 映射。
- **前端**：/soul-cards 页（供应横幅 + 我的卡册 + 可铸宠物 + 详情弹窗含铸造/销毁/凭证/流水），导航栏已接入，i18n 双语完整。
- **测试**：314/314 通过，tsc 0 错误，next build 成功。

**策略调整**：暂不部署真实区块链合约，所有区块链逻辑以「链下模拟」方式实现，接口结构为未来真实链预留。合约代码（Solidity）先写好放在 contracts/ 目录下，设置环境变量 CHAIN_DEPLOY_MODE=mock 控制开关，后续想部署时只需改配置 + 执行部署脚本。

---

## 三、阶段 2：数据库迁移与新增表（✅ 已完成 · Phase 2）

> 在现有数据库基础上新增或调整以下表结构；已有类似表尽量兼容，冲突严重时提出迁移方案，不直接删除旧数据。

### 2.1 aibiTokens — 艾比链上凭证表
字段：id (PK) / aibiTokenId (unique) / speciesId / ownerId (nullable) / walletAddress (nullable) / chainId (nullable) / contractAddress (nullable) / txHash (nullable) / status (pending|minted|burned|revoked) / mintedAt / burnedAt / burnReason / physicalBound (default false) / physicalOrderId (nullable) / createdAt / updatedAt。索引：ownerId, speciesId, status。

### 2.2 mintLogs — 增发日志表
字段：id / aibiTokenId / speciesId / toUserId (nullable) / source (pack_open|event_reward|fusion_generate|admin_mint|physical_claim) / chainTxHash / blockNumber / supplyAfter (int) / createdAt。索引：aibiTokenId, source。

### 2.3 burnLogs — 销毁日志表
字段：id / aibiTokenId / fromUserId (nullable) / reason (fusion_consume|item_consume|user_burn|expired_burn|physical_redeem) / chainTxHash / blockNumber / supplyAfter (int) / createdAt。索引：aibiTokenId, reason。

### 2.4 supplySnapshots — 总量快照表
字段：id / totalMinted / totalBurned / currentSupply / maxSupply (nullable) / chainBlock / createdAt。索引：createdAt。

### 2.5 physicalAssets — 实物资产表
字段：id / name / speciesId (nullable) / totalStock / issuedCount / redeemedCount / contractLimit (nullable) / status (default active) / createdAt / updatedAt。

### 2.6 aibiPersonalities — AI 性格表
字段：id / aibiTokenId / personalityType / mood / affinity / energy / lastInteractedAt / createdAt / updatedAt。

### 2.7 aibiGrowthLogs — 成长日志表
字段：id / aibiTokenId / actionType (feed|train|talk|play|evolve) / beforeState (json) / afterState (json) / createdAt。

### 2.8 userWallets — 用户钱包表
字段：id / userId / walletAddress / chainId / isPrimary / createdAt / updatedAt。

**落地**：drizzle/0025_aibi_platform.sql + 0026_aibi_catalog.sql + 0027_aibi_phase4_columns.sql（SCHEMA_VERSION→9 生产自动同步）。


---

## 四、阶段 3：导入种子数据（✅ 已完成 · Phase 3）

- 3.1 稀有度 ×5（颜色/倍率）、3.2 栖息地 ×5（元素倾向/描述）、3.3 物种 ×12（稀有度/元素/栖息地/简介/AI 性格模板/动效等级/3D/AI 对话）、3.4 卡包 ×4（价格/稀有度概率/产出范围/开包动画等级）、3.5 道具 ×5（类型/作用/消耗方式/影响成长/影响性格）。
- 单一数据源：`src/lib/aibi-catalog.ts`；灌库：`src/db/aibi-catalog-seed.ts`（版本闸门自动同步）+ `scripts/seed-aibi-catalog.ts`（手动 `npm run seed:aibi`）。
- ⚠️ 勘误落地：starter 卡包概率含史诗 10% 但产出范围仅普通+稀有 → 开包服务执行降级（epic→rare）；3.5 道具未定价 → 实现补全价格梯度并对齐契约测试。

## 五、阶段 4：后端核心接口开发（✅ 已完成 · Phase 4）

接口（统一约定：成功 `{data}` / 失败 `{code,message}` 双语）：
- `POST /api/pack/buy`、`POST /api/pack/open`、`GET /api/pack/list`
- `POST /api/item/buy`、`GET /api/item/list`、`POST /api/bag/use`、`GET /api/bag/items`、`GET /api/bag/aibis`
- `POST /api/aibi/mint`、`POST /api/aibi/burn`、`POST /api/aibi/fuse`、`GET /api/aibi/list`、`GET /api/aibi/owner/:wallet`、`GET /api/aibi/supply`
- `POST /api/interact`（feed/train/talk/play 成长结算）

要求落地：zod 入参校验；登录接口 Bearer 鉴权；Mint/Burn 事务一致性（BEGIN/COMMIT，失败回滚）；链下模拟 ChainProvider=mock；接口文档见 `scripts/aibi-api.http`。

## 六、阶段 5：区块链模拟服务（✅ 已完成 · Phase 4 合并落地）

- ChainSimulatorService / AibiSupplyService / AibiTokenService 能力合并进 `src/lib/aibi-service.ts`：mintAibi / burnAibi / fuseAibis / readSupply；模拟交易哈希（sha256+nonce）、模拟区块号（递增）、供应口径（mint_logs/burn_logs 计数 + aibi_tokens 实时流通）；每次 Mint/Burn 写 supply_snapshots（事件驱动）+ 生成完整日志。
- 与真实合约接口结构保持一致，后续替换真实链只换实现层；全部链上操作事务保护。

## 七、阶段 6：智能合约结构设计（✅ 代码就绪，暂不部署）

- contracts/ 目录：AibiSoulCard.sol（ERC-721）+ AibiSupplyController 结构设计（totalSupply/maxSupply/admin/minter/burner/tokenOwner/burned/mintFee/burnFee/opsReceiver；mint/burn/setMaxSupply/ownerOf/totalMinted/totalBurned/setTreasury/recoverFunds；Minted/Burned/MaxSupplyUpdated 事件）；Hardhat 部署脚本与测试用例见 contracts/README.md；CHAIN_DEPLOY_MODE=mock 控制开关。

---

## 八、阶段 7：前端页面改造（🚧 Phase 7 · 本次执行）

新增或改造以下页面：

### 8.1 首页 /
展示：艾比世界介绍、当前总供应量、最新铸造艾比、热门稀有艾比、卡包入口、图鉴入口、背包入口。

### 8.2 图鉴页 /codex
展示：所有艾比物种、按稀有度筛选、按元素筛选、按栖息地筛选、已拥有/未拥有状态。

### 8.3 艾比详情页 /aibi/[id]
展示：艾比动态形象、名称、稀有度、元素、栖息地、AI 性格、成长状态、链上凭证编号、铸造时间、持有者、交易哈希、互动入口。

### 8.4 背包页 /bag（✅ Phase 5）
展示：用户艾比列表、用户道具列表、艾比筛选、道具使用入口、艾比详情入口。

### 8.5 卡包页 /packs（✅ Phase 5）
展示：可购买卡包、卡包概率说明、开包入口、开包结果动画。

### 8.6 开包结果页 /packs/result（✅ Phase 5）
展示：抽中的艾比、稀有度动画、链上凭证生成提示、查看艾比详情按钮。

### 8.7 用户中心 /profile（🚧 本次）
展示：用户信息、钱包地址、持有艾比数量、持有道具数量、铸造记录、销毁记录。

### 8.8 总量看板 /supply（🚧 本次）
展示：当前总供应量、累计增发量、累计销毁量、最大供应量、增发销毁历史。

**要求**：页面必须组件化；不要把所有逻辑写在页面文件中；列表页必须支持分页；详情页必须支持链上信息展示；所有艾比展示必须使用统一的 AibiCard 组件。

## 九、阶段 8：AI 动态角色卡组件（🚧 Phase 8 · 本次执行）

实现艾比的核心展示组件：**AibiCard**。

- **组件属性**：aibiId, name, rarity, element, habitat, image, animationLevel, chainTokenId, status, onClick。
- **展示规则（按稀有度）**：
  | 稀有度 | 呈现方式 |
  | --- | --- |
  | 普通 | 静态立绘 + 轻微呼吸动画 + 简单边框 |
  | 稀有 | 动态立绘 + 元素粒子 + 发光边框 |
  | 史诗 | 动态立绘 + 专属背景 + 技能光效 + 稀有标签 |
  | 传说 | Spine/Lottie/视频片段 + 登场光柱 + 链上编号高亮 + 传说标签 |
  | 神话 | 全屏登场动画 + 专属背景 + AI 性格标签 + 链上稀缺编号 + 限量标识 |
- **卡面必须显示**：艾比名称、稀有度、元素、栖息地、链上凭证编号（如 Aibi #000128）、状态标签。
- **交互**：鼠标悬停显示更多信息；点击进入艾比详情页；稀有度越高动效越强。
- **要求**：组件必须可复用；支持列表页、背包页、开包结果页；动画不能阻塞页面加载；图片必须懒加载；移动端必须适配。

## 十、阶段 9：艾比详情页舞台化（✅ Phase 9 已落地）

实现 AibiStagePage，页面结构：
- 左侧：艾比形象区（动态立绘、栖息地背景、稀有度特效、链上凭证编号）
- 中间：基础信息区（名称、稀有度、元素、栖息地、状态、AI 性格、成长等级）
- 右侧：链上信息区（凭证编号、持有者钱包、铸造时间、交易哈希、合约地址、是否绑定实物）
- 下方：互动区（对话、喂食、训练、抚摸、使用道具、查看成长记录）
- 底部：历史记录（铸造记录、互动记录、成长记录、销毁记录）

要求：页面必须体现「艾比是数字生命体」，不是普通道具页；链上信息必须清晰展示；AI 性格必须可视化；互动按钮必须调用后端接口；如果用户不是持有者，只能查看，不能互动。

## 十一、阶段 10：开卡包动画系统（✅ Phase 5 已落地）

页面 /packs/result：点击开包 → 卡包震动、发光、裂开 → 稀有度先闪 → 按稀有度播放动画（普通 落卡+光效 / 稀有 翻转+元素光效 / 史诗 专属背景+光柱+卡面展开 / 传说 全屏登场+形象放大+凭证编号出现 / 神话 凭证生成动画+AI 自我介绍+全屏特效）。
技术落地：动画支持跳过；不阻塞接口请求（先返回结果再播放）；稀有度由后端决定；动画结束可跳详情；移动端降级轻量动画。

---

## 十二、每个阶段完成后的输出格式

每个阶段完成后，Cline 必须输出：本阶段已完成内容 / 新增文件列表 / 修改文件列表 / 当前项目状态 / 遇到的问题 / 下一步建议。

## 十三、最终执行要求

- 严格按照阶段顺序执行（2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10）；不要跳阶段；不要一次性实现所有功能。
- 不要直接删除现有核心代码。
- 区块链部分全部使用模拟服务（CHAIN_DEPLOY_MODE=mock），不接入主网。
- 所有涉及 Mint/Burn/库存/订单/钱包/权限的操作必须有日志和事务保护。
- 合约代码先写好放在 contracts/ 目录下，后续想部署时只需改配置 + 执行部署脚本。

**注意事项**：当前策略是「区块链思路融入网站」，不是「区块链项目」；所有链上概念用模拟实现，但接口设计要为真实链预留；重点放在：数据库设计、后端接口、前端展示、用户体验。

---

## 阶段状态总表（执行侧维护）

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| Phase 1 | 灵魂卡系统（数据层/配置/链层 mock/接口/页面） | ✅ 完成（314 测试） |
| Phase 2 | 数据库迁移与新增表（0025/0026/0027，SCHEMA_VERSION=9） | ✅ 完成 |
| Phase 3 | 种子数据（稀有度/栖息地/物种×12/卡包×4/道具×5） | ✅ 完成 |
| Phase 4 | 后端核心接口（含阶段 5 模拟服务合并落地） | ✅ 完成 |
| Phase 5 | 卡包商店/开包动画（阶段 10）/背包/灵魂卡面板/详情弹窗互动 | ✅ 完成 |
| Phase 6 | 融合/销毁 UI + 道具商店页 + 销毁守卫开关 + 数量选择 | ✅ 完成（369 测试） |
| Phase 7 | 前端页面改造：首页艾比区块 /codex /aibi/[id] /profile /supply | ✅ 完成（385 测试 + 冒烟 37/37，2026-09-30） |
| Phase 8 | AibiCard 五档动态角色卡组件（各页面统一复用） | ✅ 完成（同上） |
| Phase 9 | 艾比详情页舞台化 AibiStagePage（三栏舞台 + 内联四动作互动 + 互动时间线） | ✅ 完成（390 测试 + 冒烟 37/37，2026-09-30） |
| Phase 10 | Vercel 生产部署包（.env.production.example / db-migrate-prod.mjs / CHECKLIST.md / VERCEL_DEPLOY.md） | ✅ 完成（2026-09-30，脚本 dev 库干跑 10/10 绿） |
| Phase 11 | Stripe 支付通道接入（create-checkout / webhook 履约 / stripe_orders 表 SCHEMA_VERSION=10 / 国内支付占位 / stripe-integration.md） | ✅ 完成（408 测试 + 冒烟 42/42，2026-10-01） |
| Phase 12 | 域名与 HTTPS 配置文档（docs/domain-setup.md 9 章 + VERCEL_DEPLOY §6 + CHECKLIST §5/§6 联动，纯文档零业务代码） | ✅ 完成（2026-09-30） |
| Phase 13 | 生产上线演练（CHECKLIST 状态总表 + scripts/smoke-production.mjs 42 项 + docs/rollback.md + 上线待办清单） | ✅ 完成（2026-09-30，生产冒烟脚本 dev 演练 42/42 ALL_SMOKE_OK） |

---

## 上线待办（用户侧手动操作 · 按顺序执行，可打勾）

> 以下均需 Vercel / Neon / Stripe / DNS 控制台权限，代码侧已全部就绪。详细步骤见 `VERCEL_DEPLOY.md`、`CHECKLIST.md`（§0 状态总表实时跟踪）、`docs/domain-setup.md`、`docs/stripe-integration.md`。

- [ ] 1. **生产库迁移**：`$env:DATABASE_URL="…生产-pooler…"` → `node --experimental-loader ./tests/_paths-loader.mjs scripts/db-migrate-prod.mjs`（输出 schema synced to version 10 + 校验全绿；迁移前先在 Neon 建备份分支）
- [ ] 2. **管理员账号**：`node scripts/add-admin.cjs <邮箱> <密码(≥6位)>`（临时指向生产库，执行后立即还原 `.env`）
- [ ] 3. **环境变量**：对照 `.env.production.example` 在 Vercel Production 作用域逐项配置（`DATABASE_URL`/`AUTH_SECRET` 不带 `NEXT_PUBLIC_` 前缀；`AUTH_SECRET` ≥32 字节随机；AI key 仅留一个有效项；`CHAIN_PROVIDER=mock`）
- [ ] 4. **DNS 记录**：`www` CNAME → `cname-china.vercel-dns.com`；`@` A → `76.227.212.86`（未备案域名改用全球端点，以 Vercel Dashboard 显示为准）
- [ ] 5. **Vercel 绑域名**：Settings → Domains 加 `www.aiabw.com`（主域）+ `aiabw.com`（勾 Redirect to www），等证书状态 Ready
- [ ] 6. **HTTPS 验证**：`curl.exe -sI https://www.aiabw.com/zh` 200 + `curl.exe -sI http://aiabw.com` 308 → https www（`docs/domain-setup.md` §6 全套 7 条命令）
- [ ] 7. **域名变量收口**：`NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` = `https://www.aiabw.com` → Redeploy
- [ ] 8. **Stripe 配置（可选，配前支付走 503 降级）**：`STRIPE_SECRET_KEY` + Webhook 端点 `https://www.aiabw.com/api/stripe/webhook`（订阅 `checkout.session.completed`/`checkout.session.expired`）→ `STRIPE_WEBHOOK_SECRET` → Redeploy → 测试卡 4242 走一单（`docs/stripe-integration.md` §7）
- [ ] 9. **生产冒烟**：`$env:SMOKE_BASE="https://www.aiabw.com"` + 生产 `DATABASE_URL` → `node scripts/smoke-production.mjs` → **ALL_SMOKE_OK（42/42）**；有 Stripe 密钥时 step 40 自动切换为校验真实 Checkout URL
- [ ] 10. **管理后台核对**：`/admin/*` 登录抽查（dashboard/economy/news/pets/settings/users）
- [ ] 11. **监控与备份**：Vercel 通知/Logs 关键词告警就位；Neon 备份分支 + 首次 pg_dump 异地；`scripts/check-resources.js` 出首份用量报告
- [ ] 12. **回滚演练**：上线第一周按 `docs/rollback.md` §1/§5 真实演练一次并补录截图点位

---

_创建：2026-09-30（用户完整需求存档）。Phase 11 Stripe 支付接入：2026-10-01。Phase 12 域名/HTTPS 文档 + Phase 13 上线演练：2026-09-30。至此 Phase 1-13 全部交付，待用户侧按「上线待办」执行。_
