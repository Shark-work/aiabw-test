/**
 * 前端 DTO 类型（与 API JSON 序列化结果对齐；日期为 ISO 字符串）。
 * 与服务端 src/server/repositories/soul-card-repository.ts 的行类型保持同构，
 * 单独定义以避免前端组件依赖服务端模块。
 */

export type SoulCardStatus = "active" | "burned";

export type SoulCardDto = {
  id: string;
  petId: string;
  ownerId: string;
  name: string;
  rarity: string;
  element: string;
  habitat: string | null;
  aiPersonality: { personality?: string } & Record<string, unknown>;
  growthStage: string;
  growthLevel: number;
  growthExp: number;
  tokenId: number;
  certificateNo: string;
  mintTx: string | null;
  burnTx: string | null;
  status: SoulCardStatus;
  mintedAt: string;
  burnedAt: string | null;
  petImageUrl: string;
  speciesId: string;
  speciesNameZh: string;
  speciesNameEn: string;
};

/** 历史艾比凭证（只读，/api/soul-cards/[id] 仅对卡主本人附带）。 */
export type LegacyTokenDto = {
  aibiTokenId: string;
  speciesId: string;
  status: string;
  mintedAt: string | null;
};

export type LedgerEntryDto = {
  id: string;
  txHash: string;
  txType: "mint" | "burn" | "transfer";
  tokenId: number;
  fromAddress: string | null;
  toAddress: string | null;
  blockNumber: number;
  status: string;
  createdAt: string;
};

export type ChainStatusDto = {
  provider: {
    id: string;
    network: string;
    contractAddress: string;
    isSimulated: boolean;
  };
  supply: {
    maxSupply: number;
    totalMinted: number;
    totalBurned: number;
    circulating: number;
    nextTokenId: number;
  };
  recentTransactions: LedgerEntryDto[];
};

/** 截断展示哈希/地址：0x1234…cdef（不足长度原样返回）。 */
export function truncateHash(value: string | null | undefined): string {
  if (!value) return "—";
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
