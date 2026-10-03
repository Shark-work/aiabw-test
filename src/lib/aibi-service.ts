/**
 * 艾比平台 Phase 4 · 核心业务服务（链下模拟模式，2026-09-30）
 *
 * 设计要点：
 *  - 所有函数接受外部传入的事务 client，由路由 BEGIN/COMMIT 包裹，保证
 *    「积分扣减 + 库存变更 + 铸造/销毁 + 日志 + 快照」原子提交；
 *  - AIBI-000001 风格编号由 aibi_token_seq 序列发放（并发安全，无 count+1 竞态）；
 *  - 供应口径：totalMinted=COUNT(mint_logs)、totalBurned=COUNT(burn_logs)、
 *    currentSupply=COUNT(aibi_tokens WHERE status='minted')；每次铸造/销毁后写
 *    supply_snapshots 一行（文档 2.4「事件驱动写入」）；链下模拟不设 maxSupply（NULL）；
 *  - 新手包勘误落地（见 aibi-catalog.ts）：rollPackRarity 掷出 epic 但 allowedRarities
 *    不含时，降级到产出范围内最高一档稀有度。
 */
import { AibiError } from "./aibi-errors";
import {
  AIBI_SPECIES,
  getAibiRarity,
  getAibiSpecies,
  speciesPoolForPack,
  type AibiPack,
  type AibiSpecies,
} from "./aibi-catalog";

/** 事务 client 的最小接口（pg / @neondatabase/serverless 均满足）。 */
export interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 行形状随 SQL 变化，与 client.ts 内部类型约定一致
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

// ---------- 成长规则（interact / bag/use 共用，契约测试锁定） ----------

export const ENERGY_MAX = 100;
export const AFFINITY_MAX = 100;
export const EXP_PER_LEVEL = 100;

export interface InteractRule {
  energy: number;
  exp: number;
  affinity: number;
  mood: string;
  /** 执行该动作所需的最低精力（防止倒扣为负） */
  minEnergy: number;
}

export const INTERACT_RULES: Record<"feed" | "train" | "talk" | "play", InteractRule> = {
  feed: { energy: +20, exp: +5, affinity: +2, mood: "满足", minEnergy: 0 },
  train: { energy: -15, exp: +20, affinity: +1, mood: "专注", minEnergy: 15 },
  talk: { energy: -5, exp: +5, affinity: +5, mood: "开心", minEnergy: 5 },
  play: { energy: -10, exp: +10, affinity: +3, mood: "兴奋", minEnergy: 10 },
};

export interface GrowthState {
  personalityType: string;
  mood: string;
  affinity: number;
  energy: number;
  growthLevel: number;
  growthExp: number;
}

/** 应用成长增量：能量/亲密度夹取 [0,MAX]，经验满 EXP_PER_LEVEL 升级（可连升）。 */
export function applyGrowth(
  state: GrowthState,
  delta: { energy?: number; exp?: number; affinity?: number; mood?: string; levels?: number },
): GrowthState {
  let { growthLevel: level, growthExp: exp } = state;
  exp += delta.exp ?? 0;
  level += delta.levels ?? 0;
  while (exp >= EXP_PER_LEVEL) {
    exp -= EXP_PER_LEVEL;
    level += 1;
  }
  return {
    personalityType: state.personalityType,
    mood: delta.mood ?? state.mood,
    affinity: Math.max(0, Math.min(AFFINITY_MAX, state.affinity + (delta.affinity ?? 0))),
    energy: Math.max(0, Math.min(ENERGY_MAX, state.energy + (delta.energy ?? 0))),
    growthLevel: level,
    growthExp: exp,
  };
}

// ---------- 供应统计 ----------

export interface SupplyStats {
  totalMinted: number;
  totalBurned: number;
  currentSupply: number;
  maxSupply: number | null;
}

export async function readSupply(client: DbClient): Promise<SupplyStats> {
  const { rows } = await client.query(
    `SELECT
       (SELECT count(*)::int FROM mint_logs) AS "totalMinted",
       (SELECT count(*)::int FROM burn_logs) AS "totalBurned",
       (SELECT count(*)::int FROM aibi_tokens WHERE status = 'minted') AS "currentSupply"`,
  );
  return { ...rows[0], maxSupply: null };
}

/** 事件驱动快照（文档 2.4）：铸造/销毁后在同事务内落一行。 */
async function writeSnapshot(client: DbClient) {
  const s = await readSupply(client);
  await client.query(
    `INSERT INTO supply_snapshots ("total_minted","total_burned","current_supply","max_supply")
     VALUES ($1,$2,$3,$4)`,
    [s.totalMinted, s.totalBurned, s.currentSupply, s.maxSupply],
  );
  return s;
}


// ---------- 铸造 / 销毁 ----------

export type MintSource = "pack_open" | "event_reward" | "fusion_generate" | "admin_mint" | "physical_claim";
export type BurnReason = "fusion_consume" | "item_consume" | "user_burn" | "expired_burn" | "physical_redeem";

export interface MintedToken {
  aibiTokenId: string;
  speciesId: string;
  ownerId: string | null;
  status: string;
  mintedAt: string;
  supplyAfter: number;
}

/**
 * 铸造一只艾比（调用方须已持有事务）：
 * 发号 → aibi_tokens(status=minted) → aibi_personalities(物种性格模板) → mint_logs → supply_snapshots。
 */
export async function mintAibi(
  client: DbClient,
  opts: { speciesId: string; ownerId: string | null; source: MintSource; walletAddress?: string | null },
): Promise<MintedToken> {
  const species = getAibiSpecies(opts.speciesId);
  if (!species) throw new AibiError("SPECIES_NOT_FOUND", 404);

  const seq = await client.query(`SELECT nextval('aibi_token_seq') AS n`);
  const aibiTokenId = `AIBI-${String(seq.rows[0].n).padStart(6, "0")}`;

  const ins = await client.query(
    `INSERT INTO aibi_tokens ("aibi_token_id","species_id","owner_id","wallet_address","status","minted_at")
     VALUES ($1,$2,$3::uuid,$4,'minted',now())
     RETURNING to_char("minted_at", 'YYYY-MM-DD"T"HH24:MI:SSZ') AS "mintedAt"`,
    [aibiTokenId, opts.speciesId, opts.ownerId, opts.walletAddress ?? null],
  );

  await client.query(
    `INSERT INTO aibi_personalities ("aibi_token_id","personality_type","mood","affinity","energy","growth_level","growth_exp","last_interacted_at")
     VALUES ($1,$2,'好奇',0,$3,1,0,now())`,
    [aibiTokenId, species.personalityTemplate, ENERGY_MAX],
  );

  const supply = await readSupply(client);
  await client.query(
    `INSERT INTO mint_logs ("aibi_token_id","species_id","to_user_id","source","supply_after")
     VALUES ($1,$2,$3::uuid,$4,$5)`,
    [aibiTokenId, opts.speciesId, opts.ownerId, opts.source, supply.currentSupply],
  );
  await writeSnapshot(client);

  return {
    aibiTokenId,
    speciesId: opts.speciesId,
    ownerId: opts.ownerId,
    status: "minted",
    mintedAt: ins.rows[0].mintedAt,
    supplyAfter: supply.currentSupply,
  };
}

// ---------- 销毁守卫（Phase 6 增补：冷静期 / 积分返还可配置开关，默认 0=关闭） ----------

/**
 * 产品决策待定 → 先给开关（env 配置，服务重启生效）：
 *  - AIBI_BURN_COOLDOWN_HOURS：同一用户两次 user_burn 的最小间隔（小时），0=不限；
 *    开启后冷却期内销毁抛 BURN_COOLDOWN(429)。软守卫：同一用户并发双烧不互斥。
 *  - AIBI_BURN_REFUND_POINTS：每次 user_burn 固定返还积分，0=不返还；开启后同事务
 *    users.points += N + points_log('aibi_burn_refund')，响应附 refundedPoints 字段。
 * 仅作用于 user_burn（玩家主动销毁）；fusion_consume / 管理员 reason 不受影响。
 * 默认全关 → 现有 API 契约与行为完全不变。
 */
export const BURN_GUARD = {
  cooldownHours: Math.max(0, Number(process.env.AIBI_BURN_COOLDOWN_HOURS ?? 0) || 0),
  refundPoints: Math.max(0, Math.floor(Number(process.env.AIBI_BURN_REFUND_POINTS ?? 0) || 0)),
};

/**
 * 销毁一只艾比：原子 UPDATE 抢占 status minted→burned（并发/重复调用仅一个成功），
 * → burn_logs → supply_snapshots；user_burn 按 BURN_GUARD 开关执行冷静期/积分返还。
 */
export async function burnAibi(
  client: DbClient,
  opts: { tokenId: string; reason: BurnReason; fromUserId?: string | null },
): Promise<{ aibiTokenId: string; supplyAfter: number; refundedPoints?: number }> {
  // 冷静期开关（默认 0=关闭）：查 burn_logs 中该用户最近的 user_burn 记录
  if (opts.reason === "user_burn" && opts.fromUserId && BURN_GUARD.cooldownHours > 0) {
    const recent = await client.query(
      `SELECT 1 FROM burn_logs
        WHERE from_user_id = $1::uuid AND reason = 'user_burn'
          AND created_at > now() - make_interval(hours => $2)
        LIMIT 1`,
      [opts.fromUserId, BURN_GUARD.cooldownHours],
    );
    if (recent.rows.length) throw new AibiError("BURN_COOLDOWN", 429);
  }

  const upd = await client.query(
    `UPDATE aibi_tokens
        SET status='burned', burned_at=now(), burn_reason=$2, updated_at=now()
      WHERE aibi_token_id=$1 AND status='minted'
      RETURNING aibi_token_id`,
    [opts.tokenId, opts.reason],
  );
  if (!upd.rows.length) throw new AibiError("TOKEN_NOT_MINTED", 409);

  const supply = await readSupply(client);
  await client.query(
    `INSERT INTO burn_logs ("aibi_token_id","from_user_id","reason","supply_after")
     VALUES ($1,$2::uuid,$3,$4)`,
    [opts.tokenId, opts.fromUserId ?? null, opts.reason, supply.currentSupply],
  );

  // 积分返还开关（默认 0=关闭）：同事务返还固定积分 + 流水，响应附 refundedPoints
  let refundedPoints: number | undefined;
  if (opts.reason === "user_burn" && opts.fromUserId && BURN_GUARD.refundPoints > 0) {
    await client.query(
      `UPDATE users SET points = points + $1 WHERE id = $2::uuid`,
      [BURN_GUARD.refundPoints, opts.fromUserId],
    );
    await client.query(
      `INSERT INTO points_log (user_id, amount, reason) VALUES ($1::uuid, $2, 'aibi_burn_refund')`,
      [opts.fromUserId, BURN_GUARD.refundPoints],
    );
    refundedPoints = BURN_GUARD.refundPoints;
  }

  await writeSnapshot(client);
  return {
    aibiTokenId: opts.tokenId,
    supplyAfter: supply.currentSupply,
    ...(refundedPoints ? { refundedPoints } : {}),
  };
}


// ---------- 融合（2 只起；结果稀有度 = 素材中最高档，物种从该档池随机） ----------

export const FUSION_MIN = 2;
export const FUSION_MAX = 5;

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function fuseAibis(
  client: DbClient,
  opts: { userId: string; tokenIds: string[] },
): Promise<{ consumed: string[]; minted: MintedToken & { species: AibiSpecies } }> {
  if (opts.tokenIds.length < FUSION_MIN) throw new AibiError("FUSION_INVALID", 400);

  // 行锁抢占：同一素材并发融合仅一个事务成功提交
  const { rows } = await client.query(
    `SELECT aibi_token_id AS "tokenId", species_id AS "speciesId", owner_id::text AS "ownerId"
       FROM aibi_tokens
      WHERE aibi_token_id = ANY($1) AND status = 'minted'
      ORDER BY aibi_token_id
      FOR UPDATE`,
    [opts.tokenIds],
  );
  if (rows.length !== opts.tokenIds.length) throw new AibiError("FUSION_INVALID", 400);
  for (const r of rows) {
    if (r.ownerId !== opts.userId) throw new AibiError("TOKEN_NOT_OWNED", 403);
  }

  // 结果稀有度 = 素材中的最高档；物种从该稀有度池随机（12 物种全集）
  let topSort = -1;
  let topRarityId = "common";
  for (const r of rows) {
    const sp = getAibiSpecies(r.speciesId);
    const ra = sp ? getAibiRarity(sp.rarityId) : undefined;
    if (ra && ra.sortOrder > topSort) {
      topSort = ra.sortOrder;
      topRarityId = ra.id;
    }
  }
  // 融合结果物种池 = 全 12 物种中该稀有度的集合（不受卡包产出范围限制）
  const pool = AIBI_SPECIES.filter((s) => s.rarityId === topRarityId);
  if (!pool.length) throw new AibiError("SPECIES_NOT_FOUND", 404);
  const result = pickRandom(pool);

  for (const r of rows) {
    await burnAibi(client, { tokenId: r.tokenId, reason: "fusion_consume", fromUserId: opts.userId });
  }
  const minted = await mintAibi(client, {
    speciesId: result.id,
    ownerId: opts.userId,
    source: "fusion_generate",
  });
  return { consumed: opts.tokenIds, minted: { ...minted, species: result } };
}

// ---------- 卡包抽取（含新手包勘误降级规则） ----------

/**
 * 按 rarityWeights 加权掷稀有度；掷出档位不在 allowedRarities 时
 * 降级到产出范围内最高一档（勘误：starter epic 10% → rare）。
 */
export function rollPackRarity(pack: AibiPack): string {
  const roll = Math.random() * 100;
  let acc = 0;
  let rolled = pack.allowedRarities[0] ?? "common";
  for (const [rarityId, weight] of Object.entries(pack.rarityWeights)) {
    acc += weight;
    if (roll < acc) {
      rolled = rarityId;
      break;
    }
  }
  if (!pack.allowedRarities.includes(rolled)) {
    // 降级：产出范围内 sortOrder 最高的一档
    rolled = [...pack.allowedRarities].sort(
      (a, b) => (getAibiRarity(b)?.sortOrder ?? 0) - (getAibiRarity(a)?.sortOrder ?? 0),
    )[0];
  }
  return rolled;
}

/** 从卡包物种池（含 allowedRarities 过滤）中按指定稀有度随机抽物种。 */
export function pickSpeciesForRarity(pack: AibiPack, rarityId: string): AibiSpecies {
  // speciesPoolForPack 已按 allowedRarities + 稀有度双重过滤
  const pool = speciesPoolForPack(pack.id, rarityId);
  if (!pool.length) throw new AibiError("SPECIES_NOT_FOUND", 404);
  return pickRandom(pool);
}

// ---------- Phase 7 · 页面读路径（8.1 首页 / 8.3 详情 / 8.7 用户中心 / 8.8 看板） ----------
// 只读函数：接受外部 client（路由直接传 pool，无需事务）；公开读路径不返回用户隐私字段。

/** 8.1 首页焦点：最新铸造 N 只 + 高稀有（legendary/mythic）物种热度榜。 */
export interface SpotlightData {
  latest: { aibiTokenId: string; speciesId: string; mintedAt: string | null }[];
  rareShowcase: { speciesId: string; mintedCount: number }[];
}

export async function readSpotlight(client: DbClient, limit = 6): Promise<SpotlightData> {
  const latest = await client.query(
    `SELECT aibi_token_id AS "aibiTokenId", species_id AS "speciesId",
            minted_at AS "mintedAt"
       FROM aibi_tokens
      WHERE status = 'minted'
      ORDER BY minted_at DESC NULLS LAST, created_at DESC
      LIMIT $1`,
    [limit],
  );
  const bySpecies = await client.query(
    `SELECT species_id AS "speciesId", count(*)::int AS "mintedCount"
       FROM mint_logs
      GROUP BY species_id`,
  );
  const rarityOrder = (speciesId: string) =>
    getAibiRarity(getAibiSpecies(speciesId)?.rarityId ?? "")?.sortOrder ?? 0;
  let rareShowcase = (bySpecies.rows as { speciesId: string; mintedCount: number }[])
    .filter((r) => rarityOrder(r.speciesId) >= 4)
    .sort((a, b) => b.mintedCount - a.mintedCount)
    .slice(0, 4);
  // 还没有传说/神话被铸出时，回退为全物种热度榜（首页不留空）
  if (rareShowcase.length === 0) {
    rareShowcase = (bySpecies.rows as { speciesId: string; mintedCount: number }[])
      .sort((a, b) => b.mintedCount - a.mintedCount || rarityOrder(b.speciesId) - rarityOrder(a.speciesId))
      .slice(0, 4);
  }
  return { latest: latest.rows, rareShowcase };
}

/** 8.3 公开凭证详情：可验证性优先 —— owner 仅以钱包地址或脱敏 id 形式返回。 */
export interface AibiTokenDetail {
  aibiTokenId: string;
  speciesId: string;
  status: string;
  walletAddress: string | null;
  chainId: string | null;
  contractAddress: string | null;
  txHash: string | null;
  physicalBound: boolean;
  physicalOrderId: string | null;
  mintedAt: string | null;
  burnedAt: string | null;
  burnReason: string | null;
  createdAt: string;
  personalityType: string | null;
  mood: string | null;
  affinity: number | null;
  energy: number | null;
  growthLevel: number | null;
  growthExp: number | null;
  lastInteractedAt: string | null;
  /** Aibi ↔ 聊天（方案 a）：已绑定对话线程；仅持有者可得（路由层按 viewerIsOwner 下放） */
  threadId: string | null;
  /** 服务端内部字段（路由剥离，不下发）：仅用于比对 viewerIsOwner */
  ownerId: string | null;
  ownerDisplay: string | null;
  provenance: {
    kind: "mint" | "burn";
    source: string | null;
    reason: string | null;
    chainTxHash: string | null;
    blockNumber: string | null;
    supplyAfter: number;
    createdAt: string;
  }[];
  /** Phase 9 · 舞台互动时间线：aibi_growth_logs 最新 20 条（公开只读，无用户维度字段） */
  interactions: {
    action: string;
    mood: string | null;
    growthLevel: number | null;
    createdAt: string;
  }[];
}

export async function readTokenDetail(client: DbClient, tokenId: string): Promise<AibiTokenDetail | null> {
  const { rows } = await client.query(
    `SELECT t.aibi_token_id AS "aibiTokenId", t.species_id AS "speciesId", t.status,
            t.owner_id AS "ownerId", t.wallet_address AS "walletAddress",
            t.chain_id AS "chainId", t.contract_address AS "contractAddress", t.tx_hash AS "txHash",
            t.physical_bound AS "physicalBound", t.physical_order_id AS "physicalOrderId",
            t.minted_at AS "mintedAt", t.burned_at AS "burnedAt", t.burn_reason AS "burnReason",
            t.thread_id AS "threadId", t.created_at AS "createdAt",
            p.personality_type AS "personalityType", p.mood, p.affinity, p.energy,
            p.growth_level AS "growthLevel", p.growth_exp AS "growthExp",
            p.last_interacted_at AS "lastInteractedAt"
       FROM aibi_tokens t
       LEFT JOIN aibi_personalities p ON p.aibi_token_id = t.aibi_token_id
      WHERE t.aibi_token_id = $1
      LIMIT 1`,
    [tokenId],
  );
  const row = rows[0];
  if (!row) return null;
  // 持有者展示口径：优先钱包地址（链上身份），否则脱敏用户 id（不暴露用户名/邮箱/完整 id）
  const ownerDisplay =
    row.walletAddress ?? (row.ownerId ? `user-****${String(row.ownerId).slice(-4)}` : null);
  const { rows: provenance } = await client.query(
    `SELECT kind, source, reason, "chainTxHash", "blockNumber", "supplyAfter", "createdAt"
       FROM (
         SELECT 'mint' AS kind, source, NULL::text AS reason,
                chain_tx_hash AS "chainTxHash", block_number AS "blockNumber",
                supply_after AS "supplyAfter", created_at AS "createdAt"
           FROM mint_logs WHERE aibi_token_id = $1
         UNION ALL
         SELECT 'burn' AS kind, NULL::text AS source, reason,
                chain_tx_hash AS "chainTxHash", block_number AS "blockNumber",
                supply_after AS "supplyAfter", created_at AS "createdAt"
           FROM burn_logs WHERE aibi_token_id = $1
       ) e
      ORDER BY "createdAt" ASC`,
    [tokenId],
  );
  // Phase 9 · 互动记录时间线：成长日志 after_state(jsonb) 提取心情/等级快照，最新在前，上限 20 条
  const { rows: interactions } = await client.query(
    `SELECT action_type AS "action",
            after_state->>'mood' AS "mood",
            (after_state->>'growthLevel')::int AS "growthLevel",
            created_at AS "createdAt"
       FROM aibi_growth_logs
      WHERE aibi_token_id = $1
      ORDER BY created_at DESC
      LIMIT 20`,
    [tokenId],
  );
  return { ...row, ownerDisplay, provenance, interactions };
}

/** 8.7 用户中心聚合：持有计数 + 主钱包 + 铸造/销毁分页历史（鉴权路由内使用）。 */
export interface PagedHistory<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserAibiSummary {
  aibiCount: number;
  itemCount: number;
  packCount: number;
  wallet: { walletAddress: string; chainId: string } | null;
  mints: PagedHistory<{
    aibiTokenId: string; speciesId: string; source: string;
    chainTxHash: string | null; supplyAfter: number; createdAt: string;
  }>;
  burns: PagedHistory<{
    aibiTokenId: string; speciesId: string; reason: string;
    chainTxHash: string | null; supplyAfter: number; createdAt: string;
  }>;
}

export async function readUserAibiSummary(
  client: DbClient,
  userId: string,
  page = 1,
  pageSize = 10,
): Promise<UserAibiSummary> {
  const offset = (page - 1) * pageSize;
  const counts = await client.query(
    `SELECT
       (SELECT count(*)::int FROM aibi_tokens WHERE owner_id = $1::uuid AND status = 'minted') AS "aibiCount",
       (SELECT count(*)::int FROM user_items WHERE user_id = $1::uuid AND source = 'aibi_item') AS "itemCount",
       (SELECT count(*)::int FROM user_items WHERE user_id = $1::uuid AND source = 'aibi_pack') AS "packCount"`,
    [userId],
  );
  const wallet = await client.query(
    `SELECT wallet_address AS "walletAddress", chain_id AS "chainId"
       FROM user_wallets
      WHERE user_id = $1::uuid
      ORDER BY is_primary DESC, created_at ASC
      LIMIT 1`,
    [userId],
  );
  const mints = await client.query(
    `SELECT aibi_token_id AS "aibiTokenId", species_id AS "speciesId", source,
            chain_tx_hash AS "chainTxHash", supply_after AS "supplyAfter", created_at AS "createdAt"
       FROM mint_logs
      WHERE to_user_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, pageSize, offset],
  );
  const mintsTotal = await client.query(
    `SELECT count(*)::int AS c FROM mint_logs WHERE to_user_id = $1::uuid`,
    [userId],
  );
  // burn_logs 无 species_id 列（0025 表结构）→ 经 aibi_tokens 回填物种
  const burns = await client.query(
    `SELECT b.aibi_token_id AS "aibiTokenId", t.species_id AS "speciesId", b.reason,
            b.chain_tx_hash AS "chainTxHash", b.supply_after AS "supplyAfter", b.created_at AS "createdAt"
       FROM burn_logs b
       LEFT JOIN aibi_tokens t ON t.aibi_token_id = b.aibi_token_id
      WHERE b.from_user_id = $1::uuid
      ORDER BY b.created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, pageSize, offset],
  );
  const burnsTotal = await client.query(
    `SELECT count(*)::int AS c FROM burn_logs WHERE from_user_id = $1::uuid`,
    [userId],
  );
  return {
    aibiCount: counts.rows[0].aibiCount,
    itemCount: counts.rows[0].itemCount,
    packCount: counts.rows[0].packCount,
    wallet: wallet.rows[0] ?? null,
    mints: { rows: mints.rows, total: mintsTotal.rows[0].c, page, pageSize },
    burns: { rows: burns.rows, total: burnsTotal.rows[0].c, page, pageSize },
  };
}

/** 8.8 增发/销毁合并时间线（公开、脱敏：不含任何用户字段）+ 分页。 */
export interface SupplyHistoryRow {
  kind: "mint" | "burn";
  aibiTokenId: string;
  speciesId: string;
  source: string | null;
  reason: string | null;
  chainTxHash: string | null;
  supplyAfter: number;
  createdAt: string;
}

export async function readSupplyHistory(
  client: DbClient,
  page = 1,
  pageSize = 20,
): Promise<PagedHistory<SupplyHistoryRow>> {
  const offset = (page - 1) * pageSize;
  const total = await client.query(
    `SELECT (SELECT count(*)::int FROM mint_logs) + (SELECT count(*)::int FROM burn_logs) AS c`,
  );
  const { rows } = await client.query(
    `SELECT kind, "aibiTokenId", "speciesId", source, reason, "chainTxHash", "supplyAfter", "createdAt"
       FROM (
         SELECT 'mint' AS kind, aibi_token_id AS "aibiTokenId", species_id AS "speciesId",
                source, NULL::text AS reason, chain_tx_hash AS "chainTxHash",
                supply_after AS "supplyAfter", created_at AS "createdAt"
           FROM mint_logs
         UNION ALL
         -- burn_logs 无 species_id 列（0025 表结构）→ 经 aibi_tokens 回填物种
         SELECT 'burn' AS kind, b.aibi_token_id AS "aibiTokenId", t.species_id AS "speciesId",
                NULL::text AS source, b.reason, b.chain_tx_hash AS "chainTxHash",
                b.supply_after AS "supplyAfter", b.created_at AS "createdAt"
           FROM burn_logs b
           LEFT JOIN aibi_tokens t ON t.aibi_token_id = b.aibi_token_id
       ) e
      ORDER BY "createdAt" DESC
      LIMIT $1 OFFSET $2`,
    [pageSize, offset],
  );
  return { rows, total: total.rows[0].c, page, pageSize };
}

/** 8.8 供应快照序列（近 N 条，按时间升序返回供趋势渲染）。 */
export async function readSupplySnapshots(client: DbClient, limit = 10) {
  const { rows } = await client.query(
    `SELECT total_minted AS "totalMinted", total_burned AS "totalBurned",
            current_supply AS "currentSupply", created_at AS "createdAt"
       FROM supply_snapshots
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.reverse();
}
