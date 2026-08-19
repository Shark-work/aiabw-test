// One-time migration: upload in-repo pet avatars (public/resources/pet/*.webp) to Vercel Blob.
// Requires BLOB_READ_WRITE_TOKEN in .env (or env). Run:
//   node scripts/migrate-pets-to-blob.js
// It prints a url mapping you can paste into src/lib/pet-config.ts / src/lib/agent-profile.ts.
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
    "✗ BLOB_READ_WRITE_TOKEN not found in env or .env.\n" +
      "  1) Enable Vercel Blob in your Vercel project (Storage tab).\n" +
      "  2) Add BLOB_READ_WRITE_TOKEN to .env (local) and to Vercel env vars.\n" +
      "  3) Re-run this script.",
  );
  process.exit(2);
}

async function main() {
  const { put } = require("@vercel/blob");
  process.env.BLOB_READ_WRITE_TOKEN = token;
  const petDir = path.join(root, "public", "resources", "pet");
  const files = fs
    .readdirSync(petDir)
    .filter((f) => f.endsWith(".webp"))
    .sort();
  if (!files.length) {
    console.log("no pet webp files in public/resources/pet/ - nothing to migrate");
    return;
  }
  console.log("uploading " + files.length + " pet avatars to Vercel Blob...");
  const mapping = [];
  for (const f of files) {
    const buf = fs.readFileSync(path.join(petDir, f));
    const blob = await put("pets/" + f, buf, {
      access: "public",
      contentType: "image/webp",
      addRandomSuffix: false,
    });
    mapping.push({ file: f, url: blob.url });
    console.log("  " + f + " -> " + blob.url);
  }
  console.log("\nDone. Update references (e.g. src/lib/pet-config.ts avatar fields) with these URLs:");
  for (const m of mapping) console.log("  " + m.file + ": " + m.url);
}

main().catch((e) => {
  console.error("FATAL: " + e.message);
  process.exit(1);
});
