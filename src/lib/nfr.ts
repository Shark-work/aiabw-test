// NFR 铸造共享逻辑（在事务客户端上执行，保证原子性）：
//  - mintCollectible：为一只宠物铸造 NFR 确权记录
//    · upsert 藏品定义（digital_collectibles，物种×稀有度，首铸自动建定义）
//    · 锁定定义行校验发行量（total_supply>0 且已铸造达标 → 拒绝超发）
//    · 生成唯一 hash_id，插入 user_collectibles，置转赠/繁育冷却期
//    · minted 原子 +1
//  - drizzleQueryable：把 Drizzle 事务（tx）适配成 { query(sql, params) } 接口，
//    使 mintCollectible 可在 db.transaction 内与 Drizzle 查询共处同一事务。
import { sql } from "drizzle-orm";
import {
  makeNfrHashId,
  FIRST_MINT_COOLDOWN_MS,
  type Dna,
} from "@/lib/genetics";

export type NfrSpeciesInfo = {
  speciesId: string;
  nameZh: string;
  nameEn: string;
  category: string;
  habitat: string | null;
  rarity: string;
  element?: string;
  imageUrl: string;
};

export type MintCollectibleArgs = {
  ownerId: string;
  species: NfrSpeciesInfo;
  dna: Dna;
  generation: number;
  parentHashIds?: string[] | null;
  sourcePetId?: string | null;
  adoptionId?: string | null;
  /** 转赠冷却期（默认 24h 首发冷却） */
  transferCooldownMs?: number;
};

export type MintedCollectible = {
  id: string;
  hashId: string;
  collectibleId: string;
  lockedUntil: Date;
  breedCooldownUntil: Date;
};

type Queryable = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
};

/**
 * 将 Drizzle 事务（tx）适配为 { query(sql, params) } 接口：
 *  - 把 "…$1…$2…" 形式的 SQL 按序解析，参数用 drizzle sql`${value}` 绑定；
 *  - 在 Drizzle 事务连接上执行 → 与事务内其它 Drizzle 操作共享同一事务，
 *    任何一方失败都会触发整个事务 ROLLBACK。
 */
export function drizzleQueryable(tx: unknown): Queryable {
  const execute = (tx as { execute: (q: unknown) => Promise<unknown> }).execute.bind(tx);
  return {
    query: async (text: string, params: unknown[] = []) => {
      const parts = text.split(/\$(\d+)/);
      const chunks: ReturnType<typeof sql.raw>[] = [];
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 1) {
          const p = params[Number(parts[i]) - 1];
          chunks.push(sql`${p}`);
        } else if (parts[i].length > 0) {
          chunks.push(sql.raw(parts[i]));
        }
      }
      const res = (await execute(sql.join(chunks))) as
        | { rows?: unknown[]; rowCount?: number | null }
        | undefined;
      return {
        rows: ((res?.rows ?? []) as Array<Record<string, unknown>>).map((r) =>
          Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v as unknown])),
        ),
        rowCount: res?.rowCount ?? null,
      };
    },
  };
}

/** 在已开启的事务客户端上铸造一件 NFR（不负责 COMMIT，由调用方统一提交/回滚）。 */
export async function mintCollectible(
  client: Queryable,
  args: MintCollectibleArgs,
): Promise<MintedCollectible> {
  const { ownerId, species, dna, generation, parentHashIds } = args;
  const collectibleId = `${species.speciesId}:${species.rarity}`;
  const transferCooldownMs = args.transferCooldownMs ?? FIRST_MINT_COOLDOWN_MS;

  // 1) upsert 藏品定义（首铸自动建定义，total_supply=0 表示不限量）
  await client.query(
    `INSERT INTO digital_collectibles
       (id, species_id, name_zh, name_en, category, habitat, rarity, element,
        base_image_url, total_supply)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0)
     ON CONFLICT (id) DO NOTHING`,
    [
      collectibleId,
      species.speciesId,
      species.nameZh,
      species.nameEn,
      species.category,
      species.habitat,
      species.rarity,
      species.element ?? null,
      species.imageUrl,
    ],
  );

  // 2) 锁定定义行 → 校验发行量（防并发超发）
  const def = await client.query(
    `SELECT total_supply, minted FROM digital_collectibles WHERE id = $1 FOR UPDATE`,
    [collectibleId],
  );
  const totalSupply = Number(def.rows[0]?.total_supply ?? 0);
  const minted = Number(def.rows[0]?.minted ?? 0);
  if (totalSupply > 0 && minted >= totalSupply) {
    const err = new Error("NFR_SUPPLY_EXHAUSTED") as Error & { code?: string };
    err.code = "nfrSupplyExhausted";
    throw err;
  }

  // 3) 生成确权哈希 + 插入确权记录（含冷却期）
  const salt = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const hashId = makeNfrHashId(species.speciesId, dna, generation, ownerId, salt);
  const lockedUntil = new Date(Date.now() + transferCooldownMs);
  const breedCooldownUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const inserted = await client.query(
    `INSERT INTO user_collectibles
       (owner_id, collectible_id, source_pet_id, adoption_id, dna_sequence,
        generation, hash_id, parent_hash_ids, locked_until, breed_cooldown_until)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9, $10)
     RETURNING id, hash_id, locked_until, breed_cooldown_until`,
    [
      ownerId,
      collectibleId,
      args.sourcePetId ?? null,
      args.adoptionId ?? null,
      JSON.stringify(dna),
      generation,
      hashId,
      parentHashIds && parentHashIds.length ? JSON.stringify(parentHashIds) : null,
      lockedUntil,
      breedCooldownUntil,
    ],
  );

  // 4) 铸造数原子 +1
  await client.query(
    `UPDATE digital_collectibles SET minted = minted + 1 WHERE id = $1`,
    [collectibleId],
  );

  const row = inserted.rows[0] as Record<string, unknown>;
  return {
    id: String(row.id),
    hashId: String(row.hash_id),
    collectibleId,
    lockedUntil: new Date(String(row.locked_until)),
    breedCooldownUntil: new Date(String(row.breed_cooldown_until)),
  };
}
