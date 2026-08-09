/**
 * 一次性维护脚本：为「thread_id 为空」的旧领养记录回填对应的对话线程。
 *
 * 匹配规则：
 *   1. 遍历 adoptions 中 thread_id IS NULL 的记录；
 *   2. 候选线程 = 同 user_id 且 title = `${pet_name} 的家`，
 *      且该线程尚未被其它领养记录占用，按 created_at 升序取最早一条；
 *   3. 更新 adoptions.thread_id。
 *
 * 使用：node scripts/backfill-thread-id.js
 * 注意：脚本读取 .env 的 DATABASE_URL。生产环境请临时指向生产库再运行，
 *       运行完成后改回。
 */
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const envPath = path.join(__dirname, "..", ".env");
const env = fs.readFileSync(envPath, "utf8");
const m = env.match(/^DATABASE_URL=(.*)$/m);
const DATABASE_URL = m ? m[1].trim() : "";

if (!DATABASE_URL) {
  console.error("未在 .env 中找到 DATABASE_URL");
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const { rows } = await pool.query(
      "SELECT id, user_id, pet_name FROM adoptions WHERE thread_id IS NULL ORDER BY adopted_at ASC",
    );
    console.log(`待回填的领养记录: ${rows.length}`);

    let updated = 0;
    let skipped = 0;
    for (const a of rows) {
      const title = `${a.pet_name} 的家`;
      const cand = await pool.query(
        `SELECT id FROM threads
         WHERE user_id = $1 AND title = $2
           AND id NOT IN (SELECT thread_id FROM adoptions WHERE thread_id IS NOT NULL)
         ORDER BY created_at ASC
         LIMIT 1`,
        [a.user_id, title],
      );
      if (cand.rows.length === 0) {
        skipped++;
        continue;
      }
      await pool.query(
        "UPDATE adoptions SET thread_id = $1 WHERE id = $2",
        [cand.rows[0].id, a.id],
      );
      updated++;
    }

    console.log(`回填完成: 成功 ${updated}, 跳过(未找到唯一匹配) ${skipped}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
