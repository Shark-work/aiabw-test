/**
 * EvmChainProvider · Sepolia 测试网实现（平台升级 Phase 2，2026-09-30）
 * ----------------------------------------------------------------
 * 与 MockChainProvider 的语义差异（真链约束，业务层无感）：
 *  - 托管铸造（custodial mint）：链上 to = 平台托管地址（缺省 = MINTER_ROLE 热钱包）。
 *    原因：链下 chainAddressForUser() 派生的 sha256 地址无人持有私钥，真链铸造过去
 *    会永久锁死且无法 burn；待用户真实钱包绑定落地后经 transfer() 转出，
 *    input.toAddress 仍完整记录在链下账本 payload（审计口径不变）；
 *  - tokenId 对账守卫：以链上 SoulMinted/SoulBurned/Transfer 事件解析出的 tokenId
 *    与链下 chain_supply 分配值比对，不一致立即抛错（service DB 事务回滚 +
 *    人工对账），绝不静默吞掉序号漂移；
 *  - txHash/blockNumber 取真实回执（等待 1 个区块确认）；链上确认期间 service 的
 *    DB 事务保持开启，allocateMintSlot 的 pg_advisory_xact_lock 保证跨实例
 *    「分配顺序 == 上链顺序」。
 *
 * 注意：测试用 createEvmChainProvider() 注入假 client（无网络）；
 *      运行时经 getEvmChainProvider() 从环境变量构造单例。
 */

import { createPublicClient, createWalletClient, http, parseEventLogs } from "viem";
import type {
  Account,
  Address,
  Hash,
  PublicClient,
  WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import { certificateNoForTokenId } from "@/lib/soul-card-config";
import { AIBI_SOUL_CARD_ABI } from "./aibi-soul-card-abi";
import {
  CHAIN_CONTRACT_ADDRESS,
  CHAIN_CUSTODY_ADDRESS,
  CHAIN_DEPLOYER_KEY,
  CHAIN_NETWORK,
  CHAIN_RPC_URL,
} from "./chain-config";
import type {
  ChainBurnInput,
  ChainMintInput,
  ChainProvider,
  ChainTransferInput,
  ChainTxReceipt,
  ChainTxType,
} from "./chain-types";

/** 可注入依赖（测试以假 client 覆盖网络层，无需真实 RPC）。 */
export type EvmChainProviderDeps = {
  account: Account;
  walletClient: Pick<WalletClient, "writeContract">;
  publicClient: Pick<PublicClient, "waitForTransactionReceipt">;
  contractAddress: Address;
  custodyAddress?: Address;
  network?: string;
};

/** 三种写操作用于 tokenId 对账的事件名。 */
type ReconcileEvent = "SoulMinted" | "SoulBurned" | "Transfer";

export function createEvmChainProvider(deps: EvmChainProviderDeps): ChainProvider {
  /** 托管地址：缺省 = 签名账户自身（热钱包即平台金库）。 */
  const custody = deps.custodyAddress ?? deps.account.address;

  /** 提交交易 → 等待 1 确认 → 事件解析 tokenId 对账 → 统一回执。 */
  async function confirmAndReconcile(
    txType: ChainTxType,
    txHash: Hash,
    expectedTokenId: number,
    eventName: ReconcileEvent,
  ): Promise<ChainTxReceipt> {
    const receipt = await deps.publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
    });
    if (receipt.status !== "success") {
      throw new Error(`[chain] ${txType} tx reverted onchain: ${txHash}`);
    }
    const events = parseEventLogs({
      abi: AIBI_SOUL_CARD_ABI,
      eventName,
      logs: receipt.logs,
    }) as unknown as { args: { tokenId: bigint } }[];
    const onchainTokenId = events[0] ? Number(events[0].args.tokenId) : NaN;
    if (onchainTokenId !== expectedTokenId) {
      // 序号漂移：链上已确认、链下将回滚 → 必须人工对账，错误信息带全上下文
      throw new Error(
        `[chain] tokenId mismatch (${txType}): offchain=${expectedTokenId} onchain=${onchainTokenId} tx=${txHash}`,
      );
    }
    return {
      txHash,
      txType,
      tokenId: expectedTokenId,
      blockNumber: Number(receipt.blockNumber),
      status: "confirmed",
    };
  }

  return {
    id: "evm",
    network: deps.network ?? "sepolia",
    contractAddress: deps.contractAddress,
    isSimulated: false,

    async mint(input: ChainMintInput) {
      // 托管铸造：链上接收方为平台托管地址；certificateNo 由 tokenId 派生（与链下同源）
      const txHash = await deps.walletClient.writeContract({
        address: deps.contractAddress,
        abi: AIBI_SOUL_CARD_ABI,
        functionName: "mint",
        args: [custody, certificateNoForTokenId(input.tokenId)],
        account: deps.account,
        chain: sepolia,
      });
      return confirmAndReconcile("mint", txHash, input.tokenId, "SoulMinted");
    },

    async burn(input: ChainBurnInput) {
      const txHash = await deps.walletClient.writeContract({
        address: deps.contractAddress,
        abi: AIBI_SOUL_CARD_ABI,
        functionName: "burn",
        args: [BigInt(input.tokenId)],
        account: deps.account,
        chain: sepolia,
      });
      return confirmAndReconcile("burn", txHash, input.tokenId, "SoulBurned");
    },

    async transfer(input: ChainTransferInput) {
      // 托管 → 用户真实钱包（钱包绑定落地后的兑付通道）
      const txHash = await deps.walletClient.writeContract({
        address: deps.contractAddress,
        abi: AIBI_SOUL_CARD_ABI,
        functionName: "safeTransferFrom",
        args: [custody, input.toAddress as Address, BigInt(input.tokenId)],
        account: deps.account,
        chain: sepolia,
      });
      return confirmAndReconcile("transfer", txHash, input.tokenId, "Transfer");
    },
  };
}

let evmSingleton: ChainProvider | null = null;

/** 环境变量构造的单例（仅 isEvmChainConfigured() 为真时调用，见 get-chain-provider.ts）。 */
export function getEvmChainProvider(): ChainProvider {
  if (evmSingleton) return evmSingleton;
  const account = privateKeyToAccount(CHAIN_DEPLOYER_KEY as `0x${string}`);
  const transport = http(CHAIN_RPC_URL);
  const custodyAddress = /^0x[0-9a-fA-F]{40}$/.test(CHAIN_CUSTODY_ADDRESS)
    ? (CHAIN_CUSTODY_ADDRESS as Address)
    : undefined;
  evmSingleton = createEvmChainProvider({
    account,
    walletClient: createWalletClient({ account, chain: sepolia, transport }),
    publicClient: createPublicClient({ chain: sepolia, transport }),
    contractAddress: CHAIN_CONTRACT_ADDRESS as Address,
    custodyAddress,
    network: CHAIN_NETWORK,
  });
  return evmSingleton;
}
