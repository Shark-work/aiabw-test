import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // 快速失败：数据库不可达时 5 秒内报错，而不是无限挂起（避免前端一直“注册中/加载中”）
  connectionTimeoutMillis: 5000,
  // 显式声明最大并发物理连接数（@neondatabase/serverless 默认 10）。
  // Neon 免费版 pooler 并发上限约 10，故保持 10；如遇连接超限可调低到 5。
  max: 10,
});

export const db = drizzle(pool);

// ============================================================================
// 自动建表（幂等，用于 Serverless/首次访问时确保表结构存在）
//
// 说明：生产环境（如 Vercel）的 Neon 库可能是全新空库，且 Serverless 环境
// 无法依赖 drizzle-kit 的 fs 目录迁移。因此这里用「CREATE TABLE IF NOT EXISTS
//  + ALTER TABLE ... ADD COLUMN IF NOT EXISTS」的幂等 DDL 同步结构：
//   - 空库：直接建出全部表；
//   - 旧库：缺失的新列会被补上，不会破坏已有数据。
// 若将来修改 src/db/schema.ts，请同步更新下面的 DDL。
// ============================================================================

const SCHEMA_CREATES: string[] = [
  `CREATE TABLE IF NOT EXISTS "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "email" text NOT NULL UNIQUE,
    "password_hash" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "is_creator" boolean DEFAULT false NOT NULL,
    "is_unlocked" boolean DEFAULT false NOT NULL,
    "creator_balance" integer DEFAULT 0 NOT NULL,
    "points" integer DEFAULT 0 NOT NULL,
    "last_checkin_date" text
  )`,

  `CREATE TABLE IF NOT EXISTS "ugc_pets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "creator_id" uuid NOT NULL REFERENCES "users"("id"),
    "name" text NOT NULL,
    "image_url" text NOT NULL,
    "system_prompt" text NOT NULL,
    "price_or_points" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "ugc_sales" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "pet_id" uuid NOT NULL REFERENCES "ugc_pets"("id"),
    "buyer_id" uuid NOT NULL REFERENCES "users"("id"),
    "creator_id" uuid NOT NULL REFERENCES "users"("id"),
    "amount" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "handbooks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "adoption_id" uuid REFERENCES "adoptions"("id"),
    "title" text,
    "content" text,
    "status" text DEFAULT 'processing' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "points_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "amount" integer DEFAULT 0 NOT NULL,
    "reason" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "threads" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" text NOT NULL,
    "anonymous_id" text,
    "title" text,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "messages" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "thread_id" uuid NOT NULL REFERENCES "threads"("id"),
    "role" text NOT NULL,
    "parts" jsonb NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "adoptions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" text DEFAULT 'anonymous' NOT NULL,
    "anonymous_id" text,
    "thread_id" uuid REFERENCES "threads"("id"),
    "pet_name" text NOT NULL,
    "pet_type" text DEFAULT 'fox' NOT NULL,
    "adopted_at" timestamp DEFAULT now() NOT NULL,
    "happiness" integer DEFAULT 50 NOT NULL,
    "last_interacted_at" timestamp,
    "level" integer DEFAULT 1 NOT NULL,
    "chat_count" integer DEFAULT 0 NOT NULL,
    "monthly_points" integer DEFAULT 0 NOT NULL,
    "is_unlocked" boolean DEFAULT false NOT NULL,
    "memory_context" text
  )`,

  `CREATE TABLE IF NOT EXISTS "agent_memories" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "memory_type" text NOT NULL,
    "content" text NOT NULL,
    "embedding" double precision[] NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "last_accessed" timestamp DEFAULT now() NOT NULL,
    "important" boolean DEFAULT false NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "invite_rewards" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "inviter_id" uuid NOT NULL REFERENCES "users"("id"),
    "invited_user_id" uuid NOT NULL REFERENCES "users"("id"),
    "ip" text,
    "device_id" text,
    "amount" integer DEFAULT 50 NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  // ===== 宠物系统底层架构（预计算生成 + 宠物字典）=====
  // 宠物字典：现实动物物种（所有预计算宠物的基础模板）
  `CREATE TABLE IF NOT EXISTS "pet_dictionary" (
    "id" text PRIMARY KEY,
    "name_zh" text NOT NULL,
    "name_en" text NOT NULL,
    "category" text NOT NULL,
    "habitat" text,
    "default_description_zh" text NOT NULL,
    "default_description_en" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  // 预计算宠物实例：离线批量生成（HashLips 类工具 + Vercel Blob），synthesize 只做分配
  `CREATE TABLE IF NOT EXISTS "pets" (
    "id" text PRIMARY KEY,
    "species_id" text NOT NULL REFERENCES "pet_dictionary"("id"),
    "image_url" text NOT NULL,
    "traits" jsonb DEFAULT '{}' NOT NULL,
    "generation" integer DEFAULT 1 NOT NULL,
    "parent_ids" jsonb,
    "custom_description" text,
    "owner_id" uuid REFERENCES "users"("id"),
    "created_at" timestamp DEFAULT now() NOT NULL,
    "adopted_at" timestamp,
    "last_interaction_time" timestamp
  )`,

  // ===== NFR 数字藏品合规架构 =====
  // 藏品定义表：物种×稀有度 = 一种 NFR 藏品类型（含总发行量/已铸造数）
  `CREATE TABLE IF NOT EXISTS "digital_collectibles" (
    "id" text PRIMARY KEY,
    "species_id" text NOT NULL,
    "name_zh" text NOT NULL,
    "name_en" text NOT NULL,
    "category" text NOT NULL,
    "habitat" text,
    "rarity" text NOT NULL DEFAULT 'common',
    "element" text,
    "base_image_url" text NOT NULL,
    "total_supply" integer NOT NULL DEFAULT 0,
    "minted" integer NOT NULL DEFAULT 0,
    "description_zh" text,
    "description_en" text,
    "is_visible" boolean NOT NULL DEFAULT true,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  // 用户资产确权表：用户持有的每一件 NFR 个体（DNA/世代/哈希/冷却期）
  `CREATE TABLE IF NOT EXISTS "user_collectibles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "owner_id" uuid NOT NULL REFERENCES "users"("id"),
    "collectible_id" text NOT NULL REFERENCES "digital_collectibles"("id"),
    "source_pet_id" text REFERENCES "pets"("id"),
    "adoption_id" uuid REFERENCES "adoptions"("id"),
    "dna_sequence" jsonb NOT NULL,
    "generation" integer NOT NULL DEFAULT 1,
    "hash_id" text NOT NULL UNIQUE,
    "parent_hash_ids" jsonb,
    "locked_until" timestamp NOT NULL DEFAULT now(),
    "breed_cooldown_until" timestamp NOT NULL DEFAULT now(),
    "status" text NOT NULL DEFAULT 'active',
    "minted_at" timestamp NOT NULL DEFAULT now(),
    "transferred_count" integer NOT NULL DEFAULT 0
  )`,

  // 站点访问计数：单行汇总（id=1），原子自增 visit_count / unique_count
  `CREATE TABLE IF NOT EXISTS "site_visits" (
    "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
    "visit_count" bigint DEFAULT 0 NOT NULL,
    "unique_count" bigint DEFAULT 0 NOT NULL,
    "last_updated" timestamp DEFAULT now() NOT NULL
  )`,

  // 动物世界头条（Animal News）：全网动物趣闻聚合，热度分排序
  `CREATE TABLE IF NOT EXISTS "hotnews" (
    "id" serial PRIMARY KEY,
    "source" text NOT NULL,
    "title" text NOT NULL,
    "desc" text,
    "cover" text,
    "hot" double precision DEFAULT 0 NOT NULL,
    "timestamp" bigint DEFAULT 0 NOT NULL,
    "url" text
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_hotnews_source_title ON "hotnews" ("source", "title")`,

  // 登录审计：记录失败尝试（防暴力破解，保留最近记录用于审计）
  `CREATE TABLE IF NOT EXISTS "login_attempts" (
    "id" serial PRIMARY KEY,
    "ip" text NOT NULL,
    "email" text,
    "attempted_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON "login_attempts" ("ip", "attempted_at")`,
];

/**
 * 兼容旧库：为已有表补充后续新增的列（全部带默认值，安全回填）。
 * 注意：这些 ALTER 在“表已存在”的快速路径上也会执行（幂等）——
 * 否则新列永远不会被应用到已存在的生产库。
 */
const SCHEMA_ALTERS: string[] = [
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "pet_type" text DEFAULT 'fox' NOT NULL`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "happiness" integer DEFAULT 50 NOT NULL`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "last_interacted_at" timestamp`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "level" integer DEFAULT 1 NOT NULL`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "chat_count" integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "monthly_points" integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "is_unlocked" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "memory_context" text`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "anonymous_id" text`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "thread_id" uuid REFERENCES "threads"("id")`,
  `ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "anonymous_id" text`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_creator" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_unlocked" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "creator_balance" integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "points" integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_checkin_date" text`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_code" text`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invited_by" uuid REFERENCES "users"("id")`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "checkin_streak" integer DEFAULT 0 NOT NULL`,
  // 裂变奖励状态机：pending=冻结等待活跃验证 / credited=已发放 / expired=超时作废
  `ALTER TABLE "invite_rewards" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'credited' NOT NULL`,
  `ALTER TABLE "invite_rewards" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp`,
  `ALTER TABLE "agent_memories" ADD COLUMN IF NOT EXISTS "important" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "last_interaction_time" timestamp`,
  // ===== 站长后台（Admin Dashboard）=====
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user' NOT NULL`,
  `ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "visible" boolean DEFAULT true NOT NULL`,
  // NFR：官方品牌宠物（fox/penguin/dog）不在 pet_dictionary，藏品 species_id 无需 FK
  `ALTER TABLE "digital_collectibles" DROP CONSTRAINT IF EXISTS "digital_collectibles_species_id_fkey"`,
  `ALTER TABLE "hotnews" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'visible' NOT NULL`,
  `ALTER TABLE "hotnews" ADD COLUMN IF NOT EXISTS "pinned" boolean DEFAULT false NOT NULL`,
  // ===== 账号安全（防暴力破解）=====
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_until" timestamp`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp`,
];

/**
 * 高频查询索引（幂等，冷启动执行一次）。
 *  - adoptions.user_id：单宠限制 / 宠物列表（WHERE user_id=?）
 *  - adoptions.anonymous_id：游客宠物查询
 *  - threads.user_id：会话列表
 *  - points_log.user_id：积分流水
 */
const SCHEMA_INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_adoptions_user_id ON "adoptions" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS idx_adoptions_anonymous_id ON "adoptions" ("anonymous_id")`,
  // NFR 藏品：确权/查询索引
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_dc_species_rarity ON "digital_collectibles" ("species_id", "rarity")`,
  `CREATE INDEX IF NOT EXISTS idx_dc_rarity ON "digital_collectibles" ("rarity")`,
  `CREATE INDEX IF NOT EXISTS idx_uc_owner ON "user_collectibles" ("owner_id", "status")`,
  `CREATE INDEX IF NOT EXISTS idx_uc_collectible ON "user_collectibles" ("collectible_id")`,
  `CREATE INDEX IF NOT EXISTS idx_uc_hash ON "user_collectibles" ("hash_id")`,
  `CREATE INDEX IF NOT EXISTS idx_uc_locked ON "user_collectibles" ("locked_until")`,
  `CREATE INDEX IF NOT EXISTS idx_threads_user_id ON "threads" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS idx_points_log_user_id ON "points_log" ("user_id")`,
  // 数字人记忆：清理低频记忆（last_accessed 超过 30 天）按索引扫描，避免全表扫
  `CREATE INDEX IF NOT EXISTS idx_agent_memories_last_accessed ON "agent_memories" ("last_accessed")`,
  // 裂变邀请：邀请码唯一（并发注册防重）
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON "users" ("invite_code")`,
  // 裂变防刷：同 IP / 同设备指纹最多一次奖励
  `CREATE INDEX IF NOT EXISTS idx_invite_rewards_ip ON "invite_rewards" ("ip")`,
  `CREATE INDEX IF NOT EXISTS idx_invite_rewards_device ON "invite_rewards" ("device_id")`,
  // 裂变防刷：24h 窗口内同 IP/设备 最多 3 次（含时间列复合索引）
  `CREATE INDEX IF NOT EXISTS idx_invite_rewards_ip_time ON "invite_rewards" ("ip", "created_at")`,
  `CREATE INDEX IF NOT EXISTS idx_invite_rewards_status ON "invite_rewards" ("status", "invited_user_id")`,
  // 排行榜：战力分查询（代数降序）
  `CREATE INDEX IF NOT EXISTS idx_uc_power ON "user_collectibles" ("generation" DESC, "collectible_id")`,
  // 宠物图鉴：traits JSONB 按元素筛选（GIN 索引，毫秒级）
  `CREATE INDEX IF NOT EXISTS idx_pets_traits_gin ON "pets" USING gin ("traits")`,
  // 合成分配：owner_id IS NULL 的池子查询 + “我的宠物”列表
  `CREATE INDEX IF NOT EXISTS idx_pets_owner_id ON "pets" ("owner_id")`,
  // 宠物字典分类浏览（按物种查看）
  `CREATE INDEX IF NOT EXISTS idx_pets_species_id ON "pets" ("species_id")`,
  // 损失厌恶：批量查找“超过 N 天未互动”的宠物（状态反馈）
  `CREATE INDEX IF NOT EXISTS idx_pets_last_interaction ON "pets" ("last_interaction_time")`,
];

let schemaReadyPromise: Promise<void> | null = null;

/** 幂等建索引；并发冷启动时多实例同名索引会触发 pg_class 重复名竞态，逐个容错即可。 */
async function runIndexes(client: { query: (sql: string) => Promise<unknown> }) {
  for (const idx of SCHEMA_INDEXES) {
    try {
      await client.query(idx);
    } catch {
      // 索引幂等：其他实例已建成时本实例会拿到 duplicate name 错误，忽略即可。
      console.log("[db] index already present by another instance:", idx.slice(0, 70));
    }
  }
}

/** 幂等补列（ALTER ... ADD COLUMN IF NOT EXISTS）；并发/已存在时容错。 */
async function runAlters(client: { query: (sql: string) => Promise<unknown> }) {
  for (const stmt of SCHEMA_ALTERS) {
    try {
      await client.query(stmt);
    } catch (err) {
      // 列已存在 / 短暂锁冲突时忽略（DDL 幂等）
      console.log("[db] alter skipped:", stmt.slice(0, 60), String(err).slice(0, 120));
    }
  }
}

/**
 * 幂等建表：全局只执行一次（失败会记录日志但不抛出，避免阻断业务请求重试）。
 * 调用方 await 它即可保证“执行本次查询前表结构已就绪”。
 *
 * 性能优化：先用一条 to_regclass 查询确认核心表已存在——
 * 存在则直接跳过整套 DDL，避免每次 Serverless 冷启动都跑 17 条建表语句。
 */
export function ensureDbSchemaOnce(): Promise<void> {
  schemaReadyPromise ??= (async () => {
    const client = await pool.connect();
    try {
      // 快速路径：核心表存在则跳过 DDL
      const exists = await client.query(
        `SELECT to_regclass('public.users') AS u,
                to_regclass('public.adoptions') AS a,
                to_regclass('public.threads') AS t`,
      );
      const row = exists.rows[0] ?? {};
      if (row.u && row.a && row.t) {
        // 快速路径：核心表已存在 → 仍需幂等执行 CREATE TABLE IF NOT EXISTS
        // （否则后续新增的表——如 agent_memories——永远不会被创建到已存在的生产库）
        // + 幂等补列（ALTER）+ 补索引。
        for (const statement of SCHEMA_CREATES) {
          await client.query(statement);
        }
        await runAlters(client);
        await runIndexes(client);
        console.log("[db] schema present: tables ensured (create-if-not-exists + alters + indexes)");
        return;
      }
      for (const statement of SCHEMA_CREATES) {
        await client.query(statement);
      }
      await runAlters(client);
      await runIndexes(client);
      console.log("[db] schema ensured (tables are ready)");
    } finally {
      client.release();
    }
  })().catch((err) => {
    console.error('[db] auto schema sync failed:', err);
  });
  return schemaReadyPromise;
}

// 冷启动即触发一次自动建表（幂等，不影响后续请求）。
void ensureDbSchemaOnce();

