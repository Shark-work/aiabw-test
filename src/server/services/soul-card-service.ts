/**
 * Service 层 · Aibi Soul Card 业务（平台升级 Phase 1，2026-09-30）
 * ----------------------------------------------------------------
 * 职责：业务规则 + 事务编排，向上对接 API Controller（route.ts），
 * 向下调用 Repository（soul-card / chain-ledger）与链层（ChainProvider）。
 *
 * 核心流程：
 *  - mintSoulCard：校验宠物归属/状态/唯一性 → 从 traits 派生稀有度/元素/AI 性格
 *    → DB 事务内「原子分配 tokenId+区块号（chain_supply 硬顶）→ 链上 mint →
 *    建卡 → 记账」，任一步失败整体回滚，绝不出现「链上已铸造、链下无卡」；
 *  - burnSoulCard：校验卡片归属/流通状态 → 事务内「销毁计数+区块号 → 链上 burn →
 *    卡状态 burned → 记账」；销毁不可逆，宠物本体（pets 行）不受影响；
 *  - 查询/链状态：组装卡片+宠物展示信息+账本轨迹，供前端灵魂卡图鉴与公开审计。
 */

import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { aibiTokens } from "@/db/schema";
import {
  certificateNoForTokenId,
  normalizeElement,
  normalizeRarity,
  stageForLevel,
} from "@/lib/soul-card-config";
import {
  CHAIN_PLATFORM_ADDRESS,
  chainAddressForUser,
} from "@/server/chain/chain-config";
import type { ChainTokenMetadata } from "@/server/chain/chain-types";
import { getChainProvider } from "@/server/chain/get-chain-provider";
import * as ledgerRepo from "@/server/repositories/chain-ledger-repository";
import * as soulCardRepo from "@/server/repositories/soul-card-repository";

export type SoulCardErrorCode =
  | "PET_NOT_FOUND"
  | "PET_NOT_OWNED"
  | "PET_NOT_ACTIVE"
  | "SOUL_CARD_EXISTS"
  | "SUPPLY_EXHAUSTED"
  | "CARD_NOT_FOUND"
  | "CARD_NOT_OWNED"
  | "CARD_ALREADY_BURNED";

/** 业务错误：code 供 Controller 映射 HTTP 状态码与 i18n 文案。 */
export class SoulCardError extends Error {
  readonly code: SoulCardErrorCode;
  constructor(code: SoulCardErrorCode) {
    super(code);
    this.name = "SoulCardError";
    this.code = code;
  }
}

export type MintSoulCardInput = {
  userId: string;
  petId: string;
  /** 自定义卡名（可选，缺省用物种中文名；最长 24 字符） */
  name?: string;
};

export type BurnSoulCardInput = {
  userId: string;
  cardId: string;
};

/** 组装 ERC-721 标准 metadata（写入账本 payload；/api/chain/metadata/[tokenId] 复用为 tokenURI）。 */
export function buildTokenMetadata(input: {
  cardName: string;
  imageUrl: string;
  speciesId: string;
  rarity: string;
  element: string;
  habitat: string | null;
  personality: string | null;
  certificateNo: string;
  /** 成长阶段（缺省 seed=铸造时点；metadata 端点传当前阶段，体现动态角色卡） */
  growthStage?: string;
}): ChainTokenMetadata {
  return {
    name: input.cardName,
    description: "Aibi Soul Card · AI 动态角色卡（AI 生命体 + 区块链稀缺凭证）",
    image: input.imageUrl,
    attributes: [
      { trait_type: "species", value: input.speciesId },
      { trait_type: "rarity", value: input.rarity },
      { trait_type: "element", value: input.element },
      { trait_type: "habitat", value: input.habitat ?? "unknown" },
      { trait_type: "personality", value: input.personality ?? "unique" },
      { trait_type: "growth_stage", value: input.growthStage ?? stageForLevel(1).id },
      { trait_type: "certificate_no", value: input.certificateNo },
    ],
  };
}

/**
 * 铸造灵魂卡（Mint 增发）。
 * 不变量：一只宠物终身一张卡（pet_id UNIQUE，销毁后也不可重铸，保证稀缺与防刷）；
 * 发行量受 chain_supply.max_supply 硬顶约束（原子 UPDATE，并发不超发）。
 */
export async function mintSoulCard(
  input: MintSoulCardInput,
): Promise<soulCardRepo.SoulCardWithPet> {
  const pet = await soulCardRepo.findPetWithSpecies(input.petId);
  if (!pet) throw new SoulCardError("PET_NOT_FOUND");
  if (pet.ownerId !== input.userId) throw new SoulCardError("PET_NOT_OWNED");
  if (pet.status !== "active") throw new SoulCardError("PET_NOT_ACTIVE");

  const existing = await soulCardRepo.findSoulCardByPetId(input.petId);
  if (existing) throw new SoulCardError("SOUL_CARD_EXISTS");

  const traits = (pet.traits ?? {}) as Record<string, unknown>;
  const rarity = normalizeRarity(traits.rarity);
  const element = normalizeElement(traits.element);
  const personality =
    typeof traits.personality === "string" ? traits.personality : null;
  const customName = input.name?.trim().slice(0, 24);
  const cardName =
    customName && customName.length > 0 ? customName : pet.speciesNameZh;

  // AI 性格档案（动态角色卡的「灵魂」：后续聊天/探索节点读取并驱动行为）
  const aiPersonality = {
    personality: personality ?? "独特",
    mood: "calm",
    speechStyle: "friendly",
    curiosity: 50,
    systemPromptSeed: `${pet.speciesNameZh}:${element}:${personality ?? "unique"}`,
  };

  const cardId = await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as soulCardRepo.DbOrTx & ledgerRepo.DbOrTx;

    // 1) 链上总量控制：原子分配 tokenId + 区块号（耗尽返回 null → SUPPLY_EXHAUSTED）
    const alloc = await ledgerRepo.allocateMintSlot(tx);
    if (!alloc) throw new SoulCardError("SUPPLY_EXHAUSTED");

    const certificateNo = certificateNoForTokenId(alloc.tokenId);
    const metadata = buildTokenMetadata({
      cardName,
      imageUrl: pet.imageUrl,
      speciesId: pet.speciesId,
      rarity,
      element,
      habitat: pet.speciesHabitat,
      personality,
      certificateNo,
    });

    // 2) 链上铸造（mock=链下模拟回执；evm=提交 Sepolia 真实交易并等待出块确认）
    const provider = getChainProvider();
    const toAddress = chainAddressForUser(input.userId);
    const receipt = await provider.mint({
      toAddress,
      tokenId: alloc.tokenId,
      blockNumber: alloc.blockNumber,
      metadata,
    });

    // 3) 链下业务状态：建卡
    const card = await soulCardRepo.insertSoulCard(
      {
        petId: input.petId,
        ownerId: input.userId,
        name: cardName,
        rarity,
        element,
        habitat: pet.speciesHabitat,
        aiPersonality,
        growthStage: stageForLevel(1).id,
        growthLevel: 1,
        growthExp: 0,
        tokenId: alloc.tokenId,
        certificateNo,
        mintTx: receipt.txHash,
        status: "active",
      },
      tx,
    );

    // 4) 链上账本：mint 事件（metadata 快照，公开可审计）
    await ledgerRepo.insertLedgerEntry(
      {
        txHash: receipt.txHash,
        txType: "mint",
        tokenId: alloc.tokenId,
        fromAddress: CHAIN_PLATFORM_ADDRESS,
        toAddress,
        soulCardId: card.id,
        payload: metadata,
        blockNumber: alloc.blockNumber,
        status: receipt.status,
      },
      tx,
    );

    return card.id;
  });

  const detail = await soulCardRepo.findSoulCardById(cardId);
  if (!detail) throw new SoulCardError("CARD_NOT_FOUND");
  return detail;
}

/** 销毁灵魂卡（Burn 销毁，流通量永久 -1，不可逆；宠物本体不受影响）。 */
export async function burnSoulCard(
  input: BurnSoulCardInput,
): Promise<soulCardRepo.SoulCardWithPet> {
  const card = await soulCardRepo.findSoulCardById(input.cardId);
  if (!card) throw new SoulCardError("CARD_NOT_FOUND");
  if (card.ownerId !== input.userId) throw new SoulCardError("CARD_NOT_OWNED");
  if (card.status !== "active") throw new SoulCardError("CARD_ALREADY_BURNED");

  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as soulCardRepo.DbOrTx & ledgerRepo.DbOrTx;

    const alloc = await ledgerRepo.allocateBurnSlot(tx);
    const provider = getChainProvider();
    const receipt = await provider.burn({
      tokenId: card.tokenId,
      blockNumber: alloc.blockNumber,
    });

    await soulCardRepo.markSoulCardBurned(card.id, receipt.txHash, tx);
    await ledgerRepo.insertLedgerEntry(
      {
        txHash: receipt.txHash,
        txType: "burn",
        tokenId: card.tokenId,
        fromAddress: chainAddressForUser(input.userId),
        toAddress: CHAIN_PLATFORM_ADDRESS,
        soulCardId: card.id,
        payload: { certificate_no: card.certificateNo },
        blockNumber: alloc.blockNumber,
        status: receipt.status,
      },
      tx,
    );
  });

  const detail = await soulCardRepo.findSoulCardById(input.cardId);
  if (!detail) throw new SoulCardError("CARD_NOT_FOUND");
  return detail;
}

/** 卡片详情（含完整链上轨迹）。不存在返回 null。 */
export async function getSoulCardDetail(id: string) {
  const card = await soulCardRepo.findSoulCardById(id);
  if (!card) return null;
  const ledger = await ledgerRepo.listLedgerByTokenId(card.tokenId);
  return { card, ledger };
}

/** 我的灵魂卡列表（铸造时间倒序）。 */
export async function listMySoulCards(userId: string) {
  return soulCardRepo.listSoulCardsByOwner(userId);
}

/** 历史艾比凭证（只读）：概念收敛后停铸，存量在灵魂卡详情弹窗「历史凭证」折叠展示。 */
export async function listLegacyAibiTokens(ownerId: string) {
  return db
    .select({
      aibiTokenId: aibiTokens.aibiTokenId,
      speciesId: aibiTokens.speciesId,
      status: aibiTokens.status,
      mintedAt: aibiTokens.mintedAt,
    })
    .from(aibiTokens)
    .where(eq(aibiTokens.ownerId, ownerId))
    .orderBy(desc(aibiTokens.createdAt))
    .limit(50);
}

/** 链状态公开概览：provider 信息 + 供应计数 + 最近链上动态。 */
export async function getChainStatus() {
  const provider = getChainProvider();
  const supply = await ledgerRepo.getSupplyState();
  const recentTransactions = await ledgerRepo.listRecentLedger(20);
  return {
    provider: {
      id: provider.id,
      network: provider.network,
      contractAddress: provider.contractAddress,
      isSimulated: provider.isSimulated,
    },
    supply: supply ?? {
      maxSupply: 0,
      totalMinted: 0,
      totalBurned: 0,
      circulating: 0,
      nextTokenId: 1,
    },
    recentTransactions,
  };
}
