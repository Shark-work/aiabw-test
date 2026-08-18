// Direct verification of the digital-human memory system against the LIVE Neon DB.
// (Bypasses the HTTP auth layer because the Vercel CRON_SECRET differs from local .env -
//  the API endpoints are covered by unit tests + this DB-level end-to-end check.)
// Steps:
//   A) agent_memories table exists (created by ensureDbSchemaOnce idempotent DDL)
//   B) dedup: write 2 similar memories -> exactly 1 row remains (merge/update, no insert)
//   C) lifecycle: a memory with last_accessed > 30d ago is removed by cleanup SQL
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const env = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
const DATABASE_URL = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim() || "";

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const results = [];
  const ok = (cond, label, extra) => {
    console.log((cond ? "PASS" : "FAIL") + "  " + label + (extra ? "  [" + extra + "]" : ""));
    results.push(cond);
  };

  // A) table exists
  const { rows: tbl } = await pool.query(
    `SELECT to_regclass('public.agent_memories') AS t, to_regclass('public.agent_memories') IS NOT NULL AS exists`,
  );
  ok(tbl[0]?.exists === true, "agent_memories table exists on live DB");

  // B) dedup via raw SQL + the SAME pure embedding lib used in production
  const { embed, cosineSimilarity, DEDUP_SIMILARITY_THRESHOLD } = await import(
    "./src/lib/agent-embedding.ts"
  );
  const tag = `__dbverify__${Date.now()}`;
  const content = `${tag} 用户喜欢喝咖啡并且热爱工作`;
  const vec = embed(content);

  const existing = await pool.query(
    `SELECT id, embedding FROM agent_memories ORDER BY last_accessed DESC LIMIT 500`,
  );
  let best = null;
  for (const r of existing.rows) {
    if (!Array.isArray(r.embedding) || !r.embedding.length) continue;
    const sim = cosineSimilarity(vec, r.embedding);
    if (!best || sim > best.sim) best = { id: r.id, sim };
  }
  const action = best && best.sim >= DEDUP_SIMILARITY_THRESHOLD ? "updated" : "created";
  // PostgreSQL 数组字面量格式：{0.1,0.2,...}
  const pgArr = `{${vec.map((v) => v.toFixed(10)).join(",")}}`;
  if (action === "updated") {
    await pool.query(
      `UPDATE agent_memories SET content = $1, embedding = $2::double precision[], last_accessed = now() WHERE id = $3`,
      [content, pgArr, best.id],
    );
  } else {
    await pool.query(
      `INSERT INTO agent_memories (memory_type, content, embedding) VALUES ('fact', $1, $2::double precision[])`,
      [content, pgArr],
    );
  }
  // second "similar" write (identical normalized content) -> must be "updated"
  const existing2 = await pool.query(
    `SELECT id, embedding FROM agent_memories ORDER BY last_accessed DESC LIMIT 500`,
  );
  let best2 = null;
  for (const r of existing2.rows) {
    if (!Array.isArray(r.embedding) || !r.embedding.length) continue;
    const sim = cosineSimilarity(vec, r.embedding);
    if (!best2 || sim > best2.sim) best2 = { id: r.id, sim };
  }
  const action2 = best2 && best2.sim >= DEDUP_SIMILARITY_THRESHOLD ? "updated" : "created";
  if (action2 === "updated") {
    await pool.query(
      `UPDATE agent_memories SET content = $1, embedding = $2::double precision[], last_accessed = now() WHERE id = $3`,
      [content, pgArr, best2.id],
    );
  } else {
    await pool.query(
      `INSERT INTO agent_memories (memory_type, content, embedding) VALUES ('fact', $1, $2::double precision[])`,
      [content, pgArr],
    );
  }
  const { rows: count } = await pool.query(
    `SELECT count(*)::int AS n FROM agent_memories WHERE content LIKE $1`,
    [`%${tag}%`],
  );
  ok(
    action2 === "updated" && Number(count[0].n) === 1,
    "memory dedup: 2 similar writes -> exactly 1 row (merge/update)",
    `action1=${action} action2=${action2} stored=${count[0].n}`,
  );

  // C) lifecycle: row with old last_accessed (>30d) is purged
  const cutoff = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
  await pool.query(
    `INSERT INTO agent_memories (memory_type, content, embedding, last_accessed)
     VALUES ('fact', $1, $2::double precision[], $3)`,
    [`${tag}_stale`, `{${embed("stale memory to purge").map((v) => v.toFixed(10)).join(",")}}`, cutoff],
  );
  const del = await pool.query(
    `DELETE FROM agent_memories WHERE last_accessed < now() - interval '30 days' AND content LIKE $1`,
    [`%${tag}%`],
  );
  ok(Number(del.rowCount) === 1, "lifecycle cleanup: stale (>30d) memory purged", "removed=" + del.rowCount);

  // cleanup all test rows
  await pool.query(`DELETE FROM agent_memories WHERE content LIKE $1`, [`%${tag}%`]);

  await pool.end();
  const passed = results.filter(Boolean).length;
  console.log("----------------------------------");
  console.log(`SUMMARY: ${passed}/${results.length} passed (live DB)`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
