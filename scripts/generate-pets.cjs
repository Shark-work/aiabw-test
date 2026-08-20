// Step 2: precompute N pet records (HashLips-style batch generation) and insert into `pets`.
// - id:         deterministic unique hash ID like "#8A3F9C"
// - species_id: random from pet_dictionary
// - traits:     {"element": fire|water|earth|air, "rarity": common|uncommon|rare|epic|legendary,
//                "personality": 勇敢|温柔|机灵|高傲|慵懒}
// - image_url:  placeholder from existing in-repo webp art (real images via upload-pets-to-blob.js)
// Usage: node scripts/generate-pets.cjs [count=100]
const { Pool } = require("@neondatabase/serverless");
const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: url, max: 4 });

const COUNT = Number(process.argv[2] || 100);
const ELEMENTS = ["fire", "water", "earth", "air"];
const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];
const RARITY_WEIGHT = { common: 50, uncommon: 25, rare: 15, epic: 7, legendary: 3 };
const PERSONALITIES = ["勇敢", "温柔", "机灵", "高傲", "慵懒"];
const PLACEHOLDER_BY_CATEGORY = {
  犬科: "/resources/pet/dog.webp",
  猫科: "/resources/pet/fox2.webp",
  海洋生物: "/resources/pet/rabit.webp",
  鸟类: "/resources/pet/penguin.webp",
  大型哺乳动物: "/resources/pet/fox3.webp",
  爬行动物: "/resources/pet/monster2.webp",
  小型哺乳动物: "/resources/pet/qapi.webp",
};

function weightedRarity() {
  const total = Object.values(RARITY_WEIGHT).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const k of RARITIES) {
    r -= RARITY_WEIGHT[k];
    if (r <= 0) return k;
  }
  return "common";
}

function makeId(existing) {
  let id;
  do {
    const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0").toUpperCase();
    id = `#${hex}`;
  } while (existing.has(id));
  existing.add(id);
  return id;
}

async function main() {
  const { rows: species } = await pool.query(`SELECT id, category FROM pet_dictionary`);
  if (!species.length) {
    console.error("pet_dictionary is empty - run scripts/seed-pet-dictionary.cjs first");
    process.exit(1);
  }
  const existing = new Set();
  const rows = [];
  for (let i = 0; i < COUNT; i++) {
    const sp = species[Math.floor(Math.random() * species.length)];
    const traits = {
      element: ELEMENTS[Math.floor(Math.random() * ELEMENTS.length)],
      rarity: weightedRarity(),
      personality: PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)],
    };
    rows.push([
      makeId(existing),
      sp.id,
      PLACEHOLDER_BY_CATEGORY[sp.category] || "/resources/pet/fox2.webp",
      JSON.stringify(traits),
      1,
      null,
      null,
      null,
    ]);
  }
  // 单条多行 INSERT（避免逐行 RTT）
  const placeholders = rows.map((_, i) => `($${i * 8 + 1},$${i * 8 + 2},$${i * 8 + 3},$${i * 8 + 4}::jsonb,$${i * 8 + 5},$${i * 8 + 6}::jsonb,$${i * 8 + 7},$${i * 8 + 8})`).join(",");
  const values = rows.flat();
  await pool.query(
    `INSERT INTO pets (id, species_id, image_url, traits, generation, parent_ids, custom_description, owner_id)
     VALUES ${placeholders}`,
    values,
  );
  const { rows: agg } = await pool.query(`SELECT count(*)::int AS n, count(owner_id)::int AS owned FROM pets`);
  console.log(`generated ${COUNT} pets. total rows=${agg[0].n} owned=${agg[0].owned}`);
  await pool.end();
}

main().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
