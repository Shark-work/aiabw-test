# Aibi Soul Card · 链上合约（测试网结构）

> 平台升级 Phase 1（2026-09-30）：**链下模拟优先，合约结构先行**。
> 当前线上运行的是链下模拟链（`MockChainProvider` + `chain_supply` / `chain_ledger` 表），
> 本目录的 Solidity 合约是与模拟链语义一一对应的测试网蓝本，**尚未部署、不接主网**。

## 文件

| 文件 | 说明 |
| --- | --- |
| `AibiSoulCard.sol` | ERC-721 + Enumerable + AccessControl；`MAX_SUPPLY` 硬顶、`mint`（MINTER_ROLE）、`burn`（持币人）、`certificateNoOf`（凭证编号）、`soulStateHashOf`（链下状态摘要，审计用）；预留质押/治理扩展点 |

## 链上 ↔ 链下对账口径

| 链上 | 链下（Neon） | 说明 |
| --- | --- | --- |
| `MAX_SUPPLY` | `chain_supply.max_supply`（默认 100000，`CHAIN_MAX_SUPPLY` 可配） | 稀缺性硬顶 |
| `totalMinted` | `chain_supply.total_minted` | tokenId 从 1 单调递增、永不复用 |
| `totalBurned` | `chain_supply.total_burned` | 流通量 = minted − burned |
| `mint/burn` 交易 | `chain_ledger` 行（tx_hash 唯一） | payload 存 ERC-721 metadata 快照 |
| 用户地址 | `chainAddressForUser(userId)`（sha256 派生） | 钱包绑定落地后切换为真实地址 |

## 测试网部署步骤（Phase 2 执行，当前勿动）

1. 依赖：新建独立 hardhat/foundry 工程（**勿混入本 Next.js 仓库的 dependencies**），
   安装 `@openzeppelin/contracts@^5`（合约 import 路径按 OZ 5.x 编写）。
2. 编译：`npx hardhat compile`。
3. 部署 sepolia：`MAX_SUPPLY=100000`、`baseURI=https://aiabw.com/api/chain/metadata/`。
4. 配置服务端环境变量（Vercel 后台，**私钥永不下发前端**）：
   - `CHAIN_PROVIDER=evm`、`CHAIN_NETWORK=sepolia`
   - `CHAIN_RPC_URL`（Alchemy/Infura）、`CHAIN_DEPLOYER_KEY`（MINTER_ROLE hot wallet）
   - `CHAIN_CONTRACT_ADDRESS=0x...`（部署输出）
5. 实现 `src/server/chain/evm-chain-provider.ts`（viem/ethers，实现 `ChainProvider` 接口），
   `getChainProvider()` 即自动切换，业务代码零改动。
6. 对账：以 `chain_ledger` 模拟账本为基准做一次性历史迁移（按 tokenId 重放 mint/burn）。

## 安全红线

- 绝不把 `CHAIN_DEPLOYER_KEY` 写入仓库 / 前端 / NEXT_PUBLIC_* 变量。
- `MINTER_ROLE` 仅授予平台 hot wallet；用户钱包不授予铸造权。
- 主网部署前必须通过第三方审计 + 测试网至少 2 周灰度。
