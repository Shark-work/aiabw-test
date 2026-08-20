// Apply pets.last_interaction_time column + index to the live DB.
const { Pool } = require("@neondatabase/serverless");
const fs = require("fs");
const path = require("path");
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: url });

(async () => {
  await pool.query(`ALTER TABLE pets ADD COLUMN IF NOT EXISTS last_interaction_time timestamp`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pets_last_interaction ON pets (last_interaction_time)`);
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='pets' AND column_name='last_interaction_time'`,
  );
  console.log("column present=" + (rows.length === 1));
  const idx = await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename='pets' AND indexname='idx_pets_last_interaction'`);
  console.log("index present=" + (idx.rows.length === 1));
  await pool.end();
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
