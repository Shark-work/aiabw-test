/**
 * Repository 层 · 链下模拟账本与供应计数（平台升级 Phase 1，2026-09-30）
 * ----------------------------------------------------------------
 * 职责：chain_ledger（账本追加与查询）+ chain_supply（供应单例的原子计数）。
 * 关键不变量（对应「链上数据控制凭证总量」）：
 *  - tokenId / blockNumber 只在 chain_supply 单例行上以「原子 UPDATE ... RETURNING」
 *    分配，全局单调递增、并发安全、无需显式行锁；
 *  - mint 增发受 max_supply 硬顶约束（WHERE total_minted < max_supply，耗尽时
 *    rowCount=0 → service 层抛 SUPPLY_EXHAUSTED）；
 *  - 账本只追加不修改（append-only），tx_hash 全局唯一。
 */

import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { chainLedger } from "@/db/schema";
import type { ChainTxType } from "@/server/chain/chain-types";

export type DbOrTx = Pick<typeof db, "select" | "insert" | "execute">;

/**
 * pg 事务级咨询锁 key（任意稳定常量）：串行化「分配 tokenId → 链上 mint」全区间。
 * service 的 DB 事务内含链上提交与等待回执；持锁至事务提交/回滚，可跨实例保证
 * 链下 tokenId 分配顺序 == 链上 ++totalMinted 顺序（防并发错位触发对账守卫）。
 */
const MINT_SLOT_LOCK_ID = 727272001;

export type ChainLedgerRow = typeof chainLedger.$inferSelect;
export type NewChainLedgerRow = typeof chainLedger.$inferInsert;

export type ChainSupplyState = {
  maxSupply: number;
  totalMinted: number;
  totalBurned: number;
  circulating: number;
  nextTokenId: number;
};

/** 追加账本行（事务内调用；tx_hash 唯一约束兜底重试/并发）。 */
export async function insertLedgerEntry(
  values: NewChainLedgerRow,
  tx: DbOrTx,
): Promise<ChainLedgerRow> {
  const rows = await tx.insert(chainLedger).values(values).returning();
  return rows[0];
}

/** 某 tokenId 的完整链上轨迹（mint → transfer* → burn），按区块号升序。 */
export async function listLedgerByTokenId(
  tokenId: number,
  client: DbOrTx = db as DbOrTx,
): Promise<ChainLedgerRow[]> {
  return client
    .select()
    .from(chainLedger)
    .where(eq(chainLedger.tokenId, tokenId))
    .orderBy(chainLedger.blockNumber);
}

/** 全站最近链上动态（公开审计流），按区块号倒序。 */
export async function listRecentLedger(
  limit = 20,
  client: DbOrTx = db as DbOrTx,
): Promise<ChainLedgerRow[]> {
  return client
    .select()
    .from(chainLedger)
    .orderBy(desc(chainLedger.blockNumber))
    .limit(Math.max(1, Math.min(100, limit)));
}

/** 供应概览（只读；/api/chain/status 用）。 */
export async function getSupplyState(
  client: DbOrTx = db as DbOrTx,
): Promise<ChainSupplyState | null> {
  const res = await client.execute(sql`
    SELECT max_supply, total_minted, total_burned, next_token_id
    FROM chain_supply WHERE id = 1
  `);
  const row = (res.rows[0] ?? null) as {
    max_supply: number;
    total_minted: number;
    total_burned: number;
    next_token_id: number | string;
  } | null;
  if (!row) return null;
  return {
    maxSupply: Number(row.max_supply),
    totalMinted: Number(row.total_minted),
    totalBurned: Number(row.total_burned),
    circulating: Number(row.total_minted) - Number(row.total_burned),
    nextTokenId: Number(row.next_token_id),
  };
}

export type MintAllocation = { tokenId: number; blockNumber: number };

/**
 * 原子分配一次 mint 所需的 tokenId + blockNumber（事务内调用）：
 *  - 单条 UPDATE 完成「硬顶校验 + 三个计数器自增」，并发下不会超发/重号；
 *  - 供应耗尽时返回 null（rowCount=0），由 service 层映射为 SUPPLY_EXHAUSTED。
 */
export async function allocateMintSlot(tx: DbOrTx): Promise<MintAllocation | null> {
  // 全局串行化「分配 → 上链」区间（真链对齐关键；锁随事务提交/回滚自动释放）
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${MINT_SLOT_LOCK_ID})`);
  const res = await tx.execute(sql`
    UPDATE chain_supply
    SET total_minted = total_minted + 1,
        next_token_id = next_token_id + 1,
        next_block_number = next_block_number + 1,
        updated_at = now()
    WHERE id = 1 AND total_minted < max_supply
    RETURNING next_token_id - 1 AS token_id, next_block_number - 1 AS block_number
  `);
  const row = res.rows[0] as
    | { token_id: number | string; block_number: number | string }
    | undefined;
  if (!row) return null;
  return { tokenId: Number(row.token_id), blockNumber: Number(row.block_number) };
}

/** 原子分配一次 burn 所需的 blockNumber + 销毁计数（事务内调用）。 */
export async function allocateBurnSlot(tx: DbOrTx): Promise<{ blockNumber: number }> {
  const res = await tx.execute(sql`
    UPDATE chain_supply
    SET total_burned = total_burned + 1,
        next_block_number = next_block_number + 1,
        updated_at = now()
    WHERE id = 1
    RETURNING next_block_number - 1 AS block_number
  `);
  const row = res.rows[0] as { block_number: number | string } | undefined;
  return { blockNumber: Number(row?.block_number ?? 0) };
}

/** 原子分配一次 transfer 所需的 blockNumber（预留：交易/转赠阶段使用）。 */
export async function allocateTransferSlot(
  tx: DbOrTx,
): Promise<{ blockNumber: number }> {
  const res = await tx.execute(sql`
    UPDATE chain_supply
    SET next_block_number = next_block_number + 1,
        updated_at = now()
    WHERE id = 1
    RETURNING next_block_number - 1 AS block_number
  `);
  const row = res.rows[0] as { block_number: number | string } | undefined;
  return { blockNumber: Number(row?.block_number ?? 0) };
}

/** 账本操作类型守卫（测试与序列化用）。 */
export const LEDGER_TX_TYPES: readonly ChainTxType[] = [
  "mint",
  "burn",
  "transfer",
];
