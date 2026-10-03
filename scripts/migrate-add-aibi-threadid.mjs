// Aibi ↔ 聊天（方案 a）：aibi_tokens.thread_id 列迁移脚本（独立可跑，幂等）。
// 与 src/db/client.ts SCHEMA_ALTERS / SCHEMA_INDEXES（v12，drizzle/0029）保持一致；
// 应用冷启动的版本闸门也会自动执行同样语句——本脚本用于手动/紧急补列场景。
// 幂等保证：ALTER ... ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS，
// 可安全重复执行（重复跑无副作用，无需 ON CONFLICT 的 INSERT 场景）。
// 用法: node scripts/migrate-add-aibi-threadid.mjs
import fs from "node:fs";
import { Pool } from "@neondatabase/serverless";

const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
const DATABASE_URL = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
if (!DATABASE_URL) {
  console.error("[migrate] DATABASE_URL missing in .env");
  process.exit(1);
}
const pool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 8000 });

(async () => {
  // 1) 幂等补列：thread_id（uuid, nullable, FK → threads(id) ON DELETE SET NULL）
  await pool.query(
    `ALTER TABLE "aibi_tokens" ADD COLUMN IF NOT EXISTS "thread_id" uuid REFERENCES "threads"("id") ON DELETE SET NULL`,
  );
  console.log("[migrate] column aibi_tokens.thread_id ensured");

  // 2) 幂等补索引（chat 页按 thread_id 反查会话主体）
  await pool.query(
    `CREATE INDEX IF NOT EXISTS "idx_aibi_tokens_thread_id" ON "aibi_tokens" ("thread_id")`,
  );
  console.log("[migrate] index idx_aibi_tokens_thread_id ensured");

  // 3) 校验：列存在且 nullable / 类型 uuid
  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_name = 'aibi_tokens' AND column_name = 'thread_id'`,
  );
  const col = rows[0];
  if (!col) throw new Error("migration failed: aibi_tokens.thread_id not found after ALTER");
  if (col.data_type !== "uuid" || col.is_nullable !== "YES") {
    throw new Error(`unexpected column shape: ${JSON.stringify(col)}`);
  }
  console.log("[migrate] verified:", col);
  await pool.end();
  console.log("[migrate] done (idempotent, safe to re-run)");
})().catch((e) => {
  console.error("[migrate] failed:", e);
  process.exit(1);
});
