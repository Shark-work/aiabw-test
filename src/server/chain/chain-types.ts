/**
 * 链层抽象 · ChainProvider 接口（平台升级 Phase 1，2026-09-30）
 * ----------------------------------------------------------------
 * 设计原则（对应「链下模拟 + 测试网合约结构」执行原则）：
 *  - 所有链上操作（mint/burn/transfer）都通过 ChainProvider 接口发起，
 *    业务层（soul-card-service）不感知当前是模拟链还是真实测试网；
 *  - 当前唯一实现：MockChainProvider（链下模拟，见 mock-chain-provider.ts）；
 *  - 接入 sepolia 测试网时新增 EvmChainProvider 实现同一接口，
 *    通过 CHAIN_PROVIDER 环境变量切换，业务代码零改动；
 *  - 交易哈希/区块号/TokenId 的分配由服务端在 DB 事务内协调（见
 *    chain-ledger-repository.ts 的 chain_supply 原子计数器），Provider 只负责
 *    「执行这一笔链上动作并返回凭证」——真实链实现里即提交交易并等待回执。
 */

export type ChainTxType = "mint" | "burn" | "transfer";
export type ChainTxStatus = "confirmed" | "pending" | "failed";

export type ChainTxReceipt = {
  /** 交易哈希（模拟链为 sha256 伪哈希，0x 前缀 64 位 hex） */
  txHash: string;
  txType: ChainTxType;
  tokenId: number;
  blockNumber: number;
  status: ChainTxStatus;
};

/** ERC-721 标准 metadata 属性项（OpenSea 兼容，便于未来直接上测试网）。 */
export type ChainMetadataAttribute = {
  trait_type: string;
  value: string | number;
};

export type ChainTokenMetadata = {
  name: string;
  description: string;
  image: string;
  attributes: ChainMetadataAttribute[];
};

export type ChainMintInput = {
  /** 接收者链上地址（模拟链为 sha256 派生的确定性伪地址） */
  toAddress: string;
  tokenId: number;
  blockNumber: number;
  metadata: ChainTokenMetadata;
};

export type ChainBurnInput = {
  tokenId: number;
  blockNumber: number;
};

export type ChainTransferInput = {
  fromAddress: string;
  toAddress: string;
  tokenId: number;
  blockNumber: number;
};

export interface ChainProvider {
  /** 实现标识：mock | evm（未来） */
  readonly id: string;
  /** 网络标识：offchain-sim（模拟）| sepolia（测试网）| mainnet（远期） */
  readonly network: string;
  /** 合约地址（模拟链为占位符） */
  readonly contractAddress: string;
  /** 是否链下模拟（前端据此前置展示「模拟网络」标识） */
  readonly isSimulated: boolean;
  mint(input: ChainMintInput): Promise<ChainTxReceipt>;
  burn(input: ChainBurnInput): Promise<ChainTxReceipt>;
  transfer(input: ChainTransferInput): Promise<ChainTxReceipt>;
}
