/**
 * Repository 层 · soul_cards 数据访问（平台升级 Phase 1，2026-09-30）
 * ----------------------------------------------------------------
 * 职责：只负责 soul_cards 与 pets/pet_dictionary 的查询与写入，
 * 不含任何业务规则（归属校验/供应控制/链交互都在 service 层）。
 * 所有写操作支持传入事务 tx（drizzle transaction），保证 mint/burn 的原子性。
 */

import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { petDictionary, pets, soulCards } from "@/db/schema";
import type { GrowthStageId } from "@/lib/soul-card-config";

/** db 或事务句柄（drizzle neon-serverless transaction 与 db 接口兼容子集）。 */
export type DbOrTx = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export type SoulCardRow = typeof soulCards.$inferSelect;
export type NewSoulCardRow = typeof soulCards.$inferInsert;

/** 卡片 + 宠物展示信息（列表/详情共用的组装行）。 */
export type SoulCardWithPet = SoulCardRow & {
  petImageUrl: string;
  speciesId: string;
  speciesNameZh: string;
  speciesNameEn: string;
};

const CARD_WITH_PET_SELECT = {
  id: soulCards.id,
  petId: soulCards.petId,
  ownerId: soulCards.ownerId,
  name: soulCards.name,
  rarity: soulCards.rarity,
  element: soulCards.element,
  habitat: soulCards.habitat,
  aiPersonality: soulCards.aiPersonality,
  growthStage: soulCards.growthStage,
  growthLevel: soulCards.growthLevel,
  growthExp: soulCards.growthExp,
  tokenId: soulCards.tokenId,
  certificateNo: soulCards.certificateNo,
  mintTx: soulCards.mintTx,
  burnTx: soulCards.burnTx,
  status: soulCards.status,
  mintedAt: soulCards.mintedAt,
  burnedAt: soulCards.burnedAt,
  createdAt: soulCards.createdAt,
  updatedAt: soulCards.updatedAt,
  petImageUrl: pets.imageUrl,
  speciesId: pets.speciesId,
  speciesNameZh: petDictionary.nameZh,
  speciesNameEn: petDictionary.nameEn,
} as const;

function cardWithPetQuery(client: DbOrTx) {
  return client
    .select(CARD_WITH_PET_SELECT)
    .from(soulCards)
    .innerJoin(pets, eq(pets.id, soulCards.petId))
    .innerJoin(petDictionary, eq(petDictionary.id, pets.speciesId));
}

/** 按卡片 id 查（含宠物展示信息）；不存在返回 null。 */
export async function findSoulCardById(
  id: string,
  client: DbOrTx = db as DbOrTx,
): Promise<SoulCardWithPet | null> {
  const rows = await cardWithPetQuery(client)
    .where(eq(soulCards.id, id))
    .limit(1);
  return (rows[0] as SoulCardWithPet | undefined) ?? null;
}

/** 按宠物 id 查灵魂卡行（一只宠物终身一张卡，含已销毁）；不存在返回 null。 */
export async function findSoulCardByPetId(
  petId: string,
  client: DbOrTx = db as DbOrTx,
): Promise<SoulCardRow | null> {
  const rows = await client
    .select()
    .from(soulCards)
    .where(eq(soulCards.petId, petId))
    .limit(1);
  return rows[0] ?? null;
}

/** 按 tokenId 查（链上凭证公开解析：/api/chain/metadata/[tokenId] 用）；不存在返回 null。 */
export async function findSoulCardByTokenId(
  tokenId: number,
  client: DbOrTx = db as DbOrTx,
): Promise<SoulCardWithPet | null> {
  const rows = await cardWithPetQuery(client)
    .where(eq(soulCards.tokenId, tokenId))
    .limit(1);
  return (rows[0] as SoulCardWithPet | undefined) ?? null;
}

/** 我的灵魂卡列表（铸造时间倒序，含宠物展示信息）。 */
export async function listSoulCardsByOwner(
  ownerId: string,
  client: DbOrTx = db as DbOrTx,
): Promise<SoulCardWithPet[]> {
  const rows = await cardWithPetQuery(client)
    .where(eq(soulCards.ownerId, ownerId))
    .orderBy(desc(soulCards.mintedAt));
  return rows as SoulCardWithPet[];
}

/** 宠物基础信息 + 物种字典（mint 前置校验与字段派生用）。 */
export async function findPetWithSpecies(petId: string) {
  const rows = await (db as DbOrTx)
    .select({
      petId: pets.id,
      speciesId: pets.speciesId,
      imageUrl: pets.imageUrl,
      traits: pets.traits,
      status: pets.status,
      ownerId: pets.ownerId,
      speciesNameZh: petDictionary.nameZh,
      speciesNameEn: petDictionary.nameEn,
      speciesHabitat: petDictionary.habitat,
    })
    .from(pets)
    .innerJoin(petDictionary, eq(petDictionary.id, pets.speciesId))
    .where(eq(pets.id, petId))
    .limit(1);
  return rows[0] ?? null;
}

/** 插入灵魂卡行（事务内调用）。 */
export async function insertSoulCard(
  values: NewSoulCardRow,
  tx: DbOrTx,
): Promise<SoulCardRow> {
  const rows = await tx.insert(soulCards).values(values).returning();
  return rows[0];
}

/** 标记销毁（事务内调用）：status→burned + burn_tx/burned_at/updated_at。 */
export async function markSoulCardBurned(
  id: string,
  burnTx: string,
  tx: DbOrTx,
): Promise<void> {
  await tx
    .update(soulCards)
    .set({ status: "burned", burnTx, burnedAt: new Date(), updatedAt: new Date() })
    .where(eq(soulCards.id, id));
}

/** 成长状态写回（预留：互动/探索节点接入经验结算后调用）。 */
export async function updateSoulCardGrowth(
  id: string,
  growth: { growthLevel: number; growthExp: number; growthStage: GrowthStageId },
  client: DbOrTx = db as DbOrTx,
): Promise<void> {
  await client
    .update(soulCards)
    .set({
      growthLevel: growth.growthLevel,
      growthExp: growth.growthExp,
      growthStage: growth.growthStage,
      updatedAt: new Date(),
    })
    .where(eq(soulCards.id, id));
}
