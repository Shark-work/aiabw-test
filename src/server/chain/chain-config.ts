/**
 * 链层环境配置（平台升级 Phase 1，2026-09-30）
 * ----------------------------------------------------------------
 * 环境变量（全部可选，缺省 = 链下模拟）：
 *  - CHAIN_PROVIDER          mock（默认，链下模拟）| evm（预留，接测试网时启用）
 *  - CHAIN_NETWORK           网络标识，mock 缺省 offchain-sim；测试网建议 sepolia
 *  - CHAIN_CONTRACT_ADDRESS  合约地址（部署 contracts/AibiSoulCard.sol 后填入）
 *  - CHAIN_MAX_SUPPLY        发行上限（默认 100000，种子行已按此初始化）
 *  - CHAIN_PLATFORM_ADDRESS  平台金库地址（mint 的 from；缺省 0x0 零地址）
 *  - CHAIN_RPC_URL / CHAIN_DEPLOYER_KEY  evm 专用（Sepolia RPC / MINTER_ROLE 热钱包私钥，切勿下发前端）
 *  - CHAIN_CUSTODY_ADDRESS  平台托管地址（custodial mint 的链上 to；缺省 = 热钱包地址）
 *
 * ⚠️ 本文件仅服务端使用；NEXT_PUBLIC_* 一律不要放链上私钥。
 */

import { createHash } from "node:crypto";

import { DEFAULT_MAX_SUPPLY } from "@/lib/soul-card-config";

export const CHAIN_PROVIDER_ID = (process.env.CHAIN_PROVIDER ?? "mock").trim();

export const CHAIN_NETWORK = (
  process.env.CHAIN_NETWORK ??
  (CHAIN_PROVIDER_ID === "mock" ? "offchain-sim" : "sepolia")
).trim();

export const CHAIN_CONTRACT_ADDRESS = (
  process.env.CHAIN_CONTRACT_ADDRESS ?? "0xa1b15001ca2d0000000000000000000000000051"
).trim();

export const CHAIN_MAX_SUPPLY = Number.isFinite(
  Number(process.env.CHAIN_MAX_SUPPLY),
)
  ? Math.max(1, Math.trunc(Number(process.env.CHAIN_MAX_SUPPLY)))
  : DEFAULT_MAX_SUPPLY;

/** 平台金库地址（mint 的 from 地址；零地址 = 协议铸造语义，与 ERC-721 _mint 一致）。 */
export const CHAIN_PLATFORM_ADDRESS = (
  process.env.CHAIN_PLATFORM_ADDRESS ??
  "0x0000000000000000000000000000000000000000"
).trim();

/** evm 专用（server-only）：Sepolia RPC 端点（Alchemy/Infura/公共节点）。 */
export const CHAIN_RPC_URL = (process.env.CHAIN_RPC_URL ?? "").trim();

/** evm 专用（server-only）：MINTER_ROLE 热钱包私钥（0x+64hex）⚠️ 绝不下发前端 / 写入仓库。 */
export const CHAIN_DEPLOYER_KEY = (process.env.CHAIN_DEPLOYER_KEY ?? "").trim();

/** 平台托管地址（custodial mint 的链上 to；缺省 = 热钱包地址，见 evm-chain-provider.ts）。 */
export const CHAIN_CUSTODY_ADDRESS = (process.env.CHAIN_CUSTODY_ADDRESS ?? "").trim();

/**
 * evm 模式是否配置齐全：三项缺一不可，否则工厂回退 mock（业务永不中断）。
 * 做格式校验而非仅判空，避免半截配置直接把运行时打爆。
 */
export function isEvmChainConfigured(): boolean {
  return (
    CHAIN_PROVIDER_ID === "evm" &&
    /^https?:\/\/.+/.test(CHAIN_RPC_URL) &&
    /^0x[0-9a-fA-F]{64}$/.test(CHAIN_DEPLOYER_KEY) &&
    /^0x[0-9a-fA-F]{40}$/.test(CHAIN_CONTRACT_ADDRESS)
  );
}

/**
 * 用户链上地址（模拟派生）：
 *  - 由 userId 经 sha256 确定性派生 0x 前缀 40 位 hex，格式与 EOA 一致；
 *  - 同一用户恒定不变 → 账本记录可审计、可对账；
 *  - 未来接入真实钱包绑定时，新增 wallet 绑定表并优先使用真实地址即可，
 *    本函数保留作为未绑定用户的兜底。
 */
export function chainAddressForUser(userId: string): string {
  return (
    "0x" +
    createHash("sha256").update(`aibi-addr:${userId}`).digest("hex").slice(0, 40)
  );
}
