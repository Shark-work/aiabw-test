// 物种头像构建：assets/avatars/*.svg → public/avatars/{id}.png（512×512，透明背景）
// 设计源为手绘扁平矢量 SVG（规范见 assets/avatars/README.md）；改动后重跑：
//   node scripts/build-avatars.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "assets", "avatars");
const OUT = path.join(root, "public", "avatars");

const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".svg")).sort();
if (!files.length) {
  console.error("no svg sources in assets/avatars/");
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

let ok = 0;
for (const f of files) {
  const id = f.replace(/\.svg$/, "");
  const svg = fs.readFileSync(path.join(SRC, f));
  const buf = await sharp(svg, { density: 96 })
    .resize(512, 512, { fit: "fill" })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  const meta = await sharp(buf).metadata();
  if (meta.width !== 512 || meta.height !== 512 || !meta.hasAlpha) {
    console.error(`✗ ${id}: ${meta.width}x${meta.height} alpha=${meta.hasAlpha}`);
    process.exitCode = 1;
    continue;
  }
  fs.writeFileSync(path.join(OUT, `${id}.png`), buf);
  ok += 1;
  console.log(`✓ ${id}.png ${(buf.length / 1024).toFixed(1)}KB`);
}
console.log(`done: ${ok}/${files.length} avatars -> public/avatars/`);
