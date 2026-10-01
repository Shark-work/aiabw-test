/**
 * ChainProvider 工厂（平台升级 Phase 2，2026-09-30）
 * ----------------------------------------------------------------
 * 按 CHAIN_PROVIDER 环境变量返回当前链实现：
 *  - mock（默认）：MockChainProvider 链下模拟（本地开发/测试/演练）；
 *  - evm：EvmChainProvider（Sepolia 测试网，contracts/AibiSoulCard.sol）；
 *    CHAIN_RPC_URL / CHAIN_DEPLOYER_KEY / CHAIN_CONTRACT_ADDRESS 缺一即
 *    显式告警并回退 mock，保证业务永不中断。
 */

import { CHAIN_PROVIDER_ID, isEvmChainConfigured } from "./chain-config";
import type { ChainProvider } from "./chain-types";
import { getEvmChainProvider } from "./evm-chain-provider";
import { mockChainProvider } from "./mock-chain-provider";

export function getChainProvider(): ChainProvider {
  if (CHAIN_PROVIDER_ID === "evm") {
    if (isEvmChainConfigured()) return getEvmChainProvider();
    console.warn(
      "[chain] CHAIN_PROVIDER=evm 但 CHAIN_RPC_URL / CHAIN_DEPLOYER_KEY / CHAIN_CONTRACT_ADDRESS 未配齐，回退 mock 链下模拟",
    );
  } else if (CHAIN_PROVIDER_ID !== "mock") {
    console.warn(
      "[chain] 未知 CHAIN_PROVIDER=%s，回退 mock 链下模拟",
      CHAIN_PROVIDER_ID,
    );
  }
  return mockChainProvider;
}
