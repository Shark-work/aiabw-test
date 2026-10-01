/**
 * MockChainProvider · 链下模拟实现（平台升级 Phase 1，2026-09-30）
 * ----------------------------------------------------------------
 * 当前阶段唯一的 ChainProvider 实现：
 *  - txHash：sha256(`aibi-chain:{txType}:{tokenId}:{blockNumber}:{nonce}`)，
 *    0x 前缀 64 位 hex，格式与真实 EVM 交易哈希一致；nonce 保证并发/重试不撞车；
 *  - 无网络 IO、无 DB 依赖（纯函数式），tokenId/blockNumber 由调用方
 *    （soul-card-service 在 DB 事务内经 chain_supply 原子计数器）分配后传入；
 *  - 所有操作立即返回 status=confirmed（模拟零确认时间）。
 *
 * 注意：测试可直接 import 本文件（不触 DB），验证哈希格式与回执字段。
 */

import { createHash, randomUUID } from "node:crypto";

import {
  CHAIN_CONTRACT_ADDRESS,
  CHAIN_NETWORK,
  CHAIN_PROVIDER_ID,
} from "./chain-config";
import type {
  ChainBurnInput,
  ChainMintInput,
  ChainProvider,
  ChainTransferInput,
  ChainTxReceipt,
  ChainTxType,
} from "./chain-types";

function simulateTxHash(
  txType: ChainTxType,
  tokenId: number,
  blockNumber: number,
  nonce: string,
): string {
  return (
    "0x" +
    createHash("sha256")
      .update(`aibi-chain:${txType}:${tokenId}:${blockNumber}:${nonce}`)
      .digest("hex")
  );
}

function receipt(
  txType: ChainTxType,
  tokenId: number,
  blockNumber: number,
): ChainTxReceipt {
  return {
    txHash: simulateTxHash(txType, tokenId, blockNumber, randomUUID()),
    txType,
    tokenId,
    blockNumber,
    status: "confirmed",
  };
}

export function createMockChainProvider(options?: {
  network?: string;
  contractAddress?: string;
}): ChainProvider {
  return {
    id: "mock",
    network: options?.network ?? CHAIN_NETWORK,
    contractAddress: options?.contractAddress ?? CHAIN_CONTRACT_ADDRESS,
    isSimulated: true,
    async mint(input: ChainMintInput) {
      return receipt("mint", input.tokenId, input.blockNumber);
    },
    async burn(input: ChainBurnInput) {
      return receipt("burn", input.tokenId, input.blockNumber);
    },
    async transfer(input: ChainTransferInput) {
      return receipt("transfer", input.tokenId, input.blockNumber);
    },
  };
}

/** 默认单例（读取环境配置；测试请用 createMockChainProvider() 显式构造）。 */
export const mockChainProvider: ChainProvider =
  CHAIN_PROVIDER_ID === "mock"
    ? createMockChainProvider()
    : createMockChainProvider({ network: CHAIN_NETWORK });
