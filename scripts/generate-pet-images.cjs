// AI pet image generator (Pollinations.ai, free, no key).
// - Walks pets whose image_url is still a placeholder (/resources/...)
// - Builds a unique prompt per pet (species + element + rarity visual words + seed from pet id)
// - Saves webp to public/images/pets/{idWithoutHash}.webp and updates pets.image_url
// - On failure: retries 3x, then keeps the placeholder (never aborts the run).
// Usage: node scripts/generate-pet-images.cjs [limit=0(all)] [delayMs=1000]
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const ROOT = path.join(__dirname, "..");
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: url, max: 2 });

const LIMIT = Number(process.argv[2] || 0);
const DELAY = Number(process.argv[3] || 1000);
const OUT_DIR = path.join(ROOT, "public", "images", "pets");

// ---------- prompt engineering ----------
const ELEMENT_THEME = {
  fire: "with flames and glowing embers swirling around it",
  water: "with flowing water and sparkling bubbles around it",
  earth: "with moss, rocks and green vines around it",
  air: "with soft wind swirls and fluffy clouds around it",
};
const RARITY_VISUAL = {
  common: "simple, minimal, flat colors",
  uncommon: "slightly decorated, soft details",
  rare: "more detailed, subtle glow, ornate collar",
  epic: "very detailed, glowing aura, intricate patterns, sparkling particles",
  legendary:
    "extremely detailed, radiant golden aura, complex magical background, majestic, golden particles",
};

function buildPrompt(speciesEn, traits) {
  const element = ELEMENT_THEME[traits?.element] ?? "with a soft magical aura";
  const rarity = RARITY_VISUAL[traits?.rarity] ?? RARITY_VISUAL.common;
  const name = speciesEn || "adorable animal";
  return `A cute stylized illustration of a ${name} ${element}, ${rarity}, soft lighting, vector art style, square composition, adorable animal portrait, no text`;
}

/** seed 唯一性：pet id 形如 #RRGGBB → 解析为唯一整数（id 全局唯一 → seed 唯一）。 */
function seedFromId(id) {
  const hex = (id || "").replace(/^#/, "").padEnd(6, "0").slice(0, 6);
  return parseInt(hex, 16) || Math.floor(Math.random() * 1e6);
}

async function fetchImage(prompt, seed, attempt) {
  const urlStr = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt,
  )}?width=1024&height=1024&seed=${seed}&nologo=true&model=flux`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(urlStr, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ctype = res.headers.get("content-type") || "";
    if (!ctype.startsWith("image/")) {
      const txt = (await res.text()).slice(0, 120);
      throw new Error(`not-image (${ctype}): ${txt}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000) throw new Error(`tiny payload ${buf.length}B`);
    return buf;
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { rows } = await pool.query(
    `SELECT p.id, p.species_id, p.image_url, p.traits,
            d.name_en AS "nameEn", d.name_zh AS "nameZh"
       FROM pets p
       JOIN pet_dictionary d ON d.id = p.species_id
      WHERE p.image_url LIKE '/resources/%'
      ORDER BY p.id
      ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ""}`,
  );
  console.log(`found ${rows.length} placeholder pets to generate`);

  let ok = 0;
  let kept = 0;
  for (const [i, r] of rows.entries()) {
    const fileId = r.id.replace(/^#/, "").toLowerCase();
    const outPath = path.join(OUT_DIR, `${fileId}.webp`);
    const seed = seedFromId(r.id);
    const prompt = buildPrompt(r.nameEn || r.nameZh, r.traits);
    let buf = null;
    for (let a = 1; a <= 3 && !buf; a++) {
      try {
        buf = await fetchImage(prompt, seed, a);
      } catch (e) {
        console.log(`  [${i + 1}/${rows.length}] #${fileId} attempt${a} fail: ${e.message}`);
        if (a < 3) await new Promise((r2) => setTimeout(r2, 4000));
      }
    }
    if (!buf) {
      kept += 1;
      console.log(`  [${i + 1}/${rows.length}] #${fileId} KEPT placeholder (no image)`);
    } else {
      fs.writeFileSync(outPath, buf);
      await pool.query(`UPDATE pets SET image_url = $1 WHERE id = $2`, [
        `/images/pets/${fileId}.webp`,
        r.id,
      ]);
      ok += 1;
      console.log(`  [${i + 1}/${rows.length}] #${fileId} ${r.nameEn || r.nameZh} ${r.traits?.rarity} -> ${outPath}`);
    }
    await new Promise((r2) => setTimeout(r2, DELAY));
  }
  console.log(`DONE: generated=${ok} keptPlaceholder=${kept}`);
  await pool.end();
}

main().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
