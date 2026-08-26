// 盲盒抽奖核心执行器（在事务客户端上运行，供 draw 接口与 XorPay notify 复用）：
//  - 锁定奖池 → 加权随机抽稀有度 → 物种白名单随机 → mintCollectible 铸造 →
//    写 blindbox_logs（积分通道 orderId 为 NULL；XorPay 通道带 order_id 幂等）
//  - 调用方负责：鉴权、扣费（积分 或 确认 XorPay 已支付）、事务 COMMIT/ROLLBACK、
//    传说级社交触发（事务外）。
import { weightedPick, randomDna } from "@/lib/blindbox";
import { mintCollectible } from "@/lib/nfr";

type Queryable = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
};

export type BlindboxDrawResult = {
  rarity: string;
  isLegendary: boolean;
  speciesId: string;
  speciesNameZh: string;
  speciesNameEn: string;
  element: string;
  imageUrl: string;
  hashId: string;
  collectibleId: string;
  mintedId: string;
  lockedUntil: Date;
};

export type BlindboxDrawArgs = {
  userId: string;
  poolId: string;
  payMethod: "points" | "xorpay";
  cost: number;
  /** XorPay 订单号（幂等键；积分通道可省略） */
  orderId?: string;
};

/**
 * 在已开启的事务客户端上执行抽奖（不负责 COMMIT / ROLLBACK）。
 * 若 orderId 已存在（XorPay 重复回调）→ 返回 null（调用方应返回 success，幂等）。
 */
export async function executeBlindboxDraw(
  client: Queryable,
  args: BlindboxDrawArgs,
): Promise<BlindboxDrawResult | null> {
  const { userId, poolId, payMethod, cost, orderId } = args;

  // XorPay 幂等：同一 order_id 已抽过 → 直接返回 null
  if (orderId) {
    const dup = await client.query(`SELECT 1 FROM blindbox_logs WHERE order_id = $1`, [orderId]);
    if (dup.rows.length > 0) return null;
  }

  // 1) 锁定奖池并校验激活
  const { rows: poolRows } = await client.query(
    `SELECT id, probabilities, species_ids AS "speciesIds", is_active AS "isActive"
       FROM blindbox_pools WHERE id = $1 FOR UPDATE`,
    [poolId],
  );
  const poolRow = poolRows[0];
  if (!poolRow || poolRow.isActive === false) {
    const err = new Error("POOL_UNAVAILABLE") as Error & { code?: string };
    err.code = "blindboxUnavailable";
    throw err;
  }

  // 2) 加权随机抽稀有度
  const rarity = weightedPick((poolRow.probabilities ?? {}) as Record<string, number>);
  const isLegendary = rarity === "legendary";

  // 3) 物种白名单随机（空 = 全部字典物种）
  const speciesList =
    Array.isArray(poolRow.speciesIds) && poolRow.speciesIds.length > 0
      ? (poolRow.speciesIds as string[])
      : (await client.query(`SELECT id FROM pet_dictionary`)).rows.map((r) => String(r.id));
  const speciesId = speciesList[Math.floor(Math.random() * speciesList.length)];
  const { rows: spRows } = await client.query(
    `SELECT d.id, d.name_zh AS "nameZh", d.name_en AS "nameEn", d.category, d.habitat,
            (SELECT p.image_url FROM pets p
              WHERE p.species_id = d.id AND p.image_url IS NOT NULL LIMIT 1) AS "imageUrl"
       FROM pet_dictionary d WHERE d.id = $1 LIMIT 1`,
    [speciesId],
  );
  const sp = spRows[0];
  if (!sp) {
    const err = new Error("SPECIES_MISSING") as Error & { code?: string };
    err.code = "blindboxSpeciesMissing";
    throw err;
  }

  // 4) 铸造 NFR（同一事务）
  const dna = randomDna();
  const minted = await mintCollectible(client, {
    ownerId: userId,
    species: {
      speciesId: String(sp.id),
      nameZh: String(sp.nameZh),
      nameEn: String(sp.nameEn),
      category: String(sp.category),
      habitat: sp.habitat ? String(sp.habitat) : null,
      rarity,
      element: dna.element,
      imageUrl: String(sp.imageUrl ?? ""),
    },
    dna: { ...dna, rarity },
    generation: 1,
    parentHashIds: null,
    sourcePetId: null,
    adoptionId: null,
  });

  // 5) 写抽奖流水（同一事务；order_id 唯一约束兜底幂等）
  await client.query(
    `INSERT INTO blindbox_logs
       (user_id, pool_id, result_collectible_id, result_hash_id, is_legendary, pay_method, cost, order_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, poolId, minted.collectibleId, minted.hashId, isLegendary, payMethod, cost, orderId ?? null],
  );

  return {
    rarity,
    isLegendary,
    speciesId: String(sp.id),
    speciesNameZh: String(sp.nameZh),
    speciesNameEn: String(sp.nameEn),
    element: dna.element,
    imageUrl: String(sp.imageUrl ?? ""),
    hashId: minted.hashId,
    collectibleId: minted.collectibleId,
    mintedId: minted.id,
    lockedUntil: minted.lockedUntil,
  };
}
