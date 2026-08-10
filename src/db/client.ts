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

const SCHEMA_STATEMENTS: string[] = [
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

  // —— 兼容旧库：为已有表补充后续新增的列（全部带默认值，安全回填） ——
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
  `CREATE INDEX IF NOT EXISTS idx_threads_user_id ON "threads" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS idx_points_log_user_id ON "points_log" ("user_id")`,
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
        // 表已存在：仅补索引（幂等，一次冷启动执行一次）
        await runIndexes(client);
        console.log("[db] schema already present, skip DDL (indexes ensured)");
        return;
      }
      for (const statement of SCHEMA_STATEMENTS) {
        await client.query(statement);
      }
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

