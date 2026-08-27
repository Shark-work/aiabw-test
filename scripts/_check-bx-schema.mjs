// 临时：加载 .env 后手动触发 schema 同步（确保盲盒表存在）
import fs from "node:fs";
const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
process.env.DATABASE_URL = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const { pool, ensureDbSchemaOnce } = await import("../src/db/client.ts");
await ensureDbSchemaOnce();
const r = await pool.query(
  "SELECT to_regclass('public.blindbox_pools') AS p, to_regclass('public.blindbox_logs') AS l",
);
console.log("tables:", JSON.stringify(r.rows[0]));
await pool.end();
