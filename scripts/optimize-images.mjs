// Asset optimizer: re-encodes large PNG assets into WebP (used by the CSS background + avatars).
//  - resources/background_clothing/bg1.png -> bg1.webp  (1920w, q55)  ~33.6MB -> ~100-200KB
//  - resources/pet/*.png                    -> *.webp      (512w, q68)  (avatars render at <=96px)
// Originals are then deleted from the repo (see the step-A comments in the performance PR).
// Run: node scripts/optimize-images.mjs
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

const jobs = [
  {
    file: "resources/background_clothing/bg1.png",
    maxWidth: 1920,
    quality: 55,
    note: "hero background",
  },
  ...fs
    .readdirSync(path.join(publicDir, "resources", "pet"))
    .filter((f) => f.endsWith(".png"))
    .map((f) => ({
      file: path.join("resources", "pet", f),
      maxWidth: 512,
      quality: 68,
      note: "pet avatar",
    })),
];

for (const job of jobs) {
  const abs = path.join(publicDir, job.file);
  if (!fs.existsSync(abs)) {
    console.log("skip (missing):", job.file);
    continue;
  }
  const meta = await sharp(abs).metadata();
  const width = Math.min(meta.width ?? job.maxWidth, job.maxWidth);
  const out = abs.replace(/\.png$/, ".webp");
  const buf = await sharp(abs)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: job.quality, effort: 6 })
    .toBuffer();
  fs.writeFileSync(out, buf);
  const h = Math.round(((meta.height ?? 0) * width) / (meta.width || 1));
  const beforeKb = (fs.statSync(abs).size / 1024).toFixed(1);
  const afterKb = (buf.length / 1024).toFixed(1);
  console.log(
    `${job.note.padEnd(14)} ${path.basename(out)}  ${width}x${h}  ${beforeKb} KB -> ${afterKb} KB`,
  );
}
console.log("done. verify with: node scripts/check-assets.js");
