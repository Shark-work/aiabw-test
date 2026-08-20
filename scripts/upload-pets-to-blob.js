// Step 2b: upload pet images to Vercel Blob and update pets.image_url.
// Real pipeline: HashLips generates 10k images -> this script uploads them.
// Current placeholders: maps each unowned pet to an in-repo webp (deterministic key pets/<id>.webp).
// Usage: node scripts/upload-pets-to-blob.js
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");
const token =
  process.env.BLOB_READ_WRITE_TOKEN ||
  (fs.existsSync(envPath)
    ? (fs.readFileSync(envPath, "utf8").match(/^BLOB_READ_WRITE_TOKEN=(.*)$/m) || [])[1]?.trim()
    : "") ||
  "";

if (!token) {
  console.error(
    "✗ BLOB_READ_WRITE_TOKEN not found. Add it to .env / Vercel env, then re-run.\n" +
      "  本地测试阶段 pets.image_url 使用 /resources/pet/*.webp 占位图，不影响功能验证。",
  );
  process.exit(2);
}

const { Pool } = require("@neondatabase/serverless");
const env = fs.readFileSync(envPath, "utf8");
const dbUrl = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: dbUrl, max: 4 });

const PLACEHOLDER_BY_CATEGORY = {
  犬科: "public/resources/pet/dog.webp",
  猫科: "public/resources/pet/fox2.webp",
  海洋生物: "public/resources/pet/rabit.webp",
  鸟类: "public/resources/pet/penguin.webp",
  大型哺乳动物: "public/resources/pet/fox3.webp",
  爬行动物: "public/resources/pet/monster2.webp",
  小型哺乳动物: "public/resources/pet/qapi.webp",
};

async function main() {
  const { put } = require("@vercel/blob");
  process.env.BLOB_READ_WRITE_TOKEN = token;
  const { rows } = await pool.query(
    `SELECT p.id, p.species_id, d.category
       FROM pets p JOIN pet_dictionary d ON d.id = p.species_id
      WHERE p.image_url LIKE '/resources/%' LIMIT 1000`,
  );
  console.log("uploading " + rows.length + " pet images...");
  let done = 0;
  for (const pet of rows) {
    const local = PLACEHOLDER_BY_CATEGORY[pet.category] || "public/resources/pet/fox2.webp";
    const abs = path.join(root, local);
    if (!fs.existsSync(abs)) continue;
    const buf = fs.readFileSync(abs);
    const blob = await put("pets/" + pet.id.slice(1) + ".webp", buf, {
      access: "public",
      contentType: "image/webp",
      addRandomSuffix: false,
    });
    await pool.query(`UPDATE pets SET image_url=$1 WHERE id=$2`, [blob.url, pet.id]);
    done++;
  }
  console.log(`uploaded ${done}/${rows.length} images to Vercel Blob.`);
  await pool.end();
}

main().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
