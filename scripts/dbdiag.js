// Diagnostic: compare Neon POOLER vs DIRECT connection latency (5x SELECT 1 each).
// Usage: node scripts/dbdiag.js
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const m = env.match(/^DATABASE_URL=(.*)$/m);
const POOLER_URL = m ? m[1].trim() : "";
if (!POOLER_URL) {
  console.error("no DATABASE_URL in .env");
  process.exit(1);
}
// Build the DIRECT url: same host minus the "-pooler" suffix token.
// e.g. ep-gentle-voice-aydec9gp-pooler.c-5.us-east-2.aws.neon.tech
//   -> ep-gentle-voice-aydec9gp.c-5.us-east-2.aws.neon.tech
const DIRECT_URL = POOLER_URL.replace(/-pooler\./i, ".");

async function bench(label, url, rounds = 5) {
  const pool = new Pool({ connectionString: url });
  const times = [];
  try {
    for (let i = 0; i < rounds; i++) {
      const t0 = Date.now();
      await pool.query("SELECT 1");
      times.push(Date.now() - t0);
    }
  } finally {
    await pool.end();
  }
  console.log(label + "  " + times.map((t, i) => "q" + (i + 1) + "=" + t + "ms").join("  "));
  return times;
}

(async () => {
  console.log("pooler=" + POOLER_URL.replace(/:\/\/[^@]+@/, "://***@"));
  console.log("direct=" + DIRECT_URL.replace(/:\/\/[^@]+@/, "://***@"));
  console.log("--- (local machine -> Neon us-east-2; absolute times include China RTT) ---");
  await bench("POOLER", POOLER_URL);
  await bench("DIRECT", DIRECT_URL);
})();
