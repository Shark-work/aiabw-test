// 从 src/app/icon.svg 生成 PWA 图标（manifest 各尺寸 + apple-touch-icon）。
// 产物：
//   public/icons/icon-192.png / icon-512.png          —— manifest 普通图标
//   public/icons/icon-maskable-192/512.png            —— manifest maskable（满铺背景，内容已在 80% 安全区）
//   src/app/apple-icon.png (180x180)                  —— App Router 约定，自动注入 <link rel="apple-touch-icon">
// Usage: node scripts/generate-pwa-icons.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = await readFile(path.join(ROOT, "src/app/icon.svg"), "utf8");

// maskable 变体：圆角矩形改直角满铺（爪印各元素距中心均 < 80% 安全区半径，无需缩放）
const maskableSvg = svg.replace('rx="14"', 'rx="0"');

const jobs = [
  { input: svg, size: 192, out: "public/icons/icon-192.png" },
  { input: svg, size: 512, out: "public/icons/icon-512.png" },
  { input: maskableSvg, size: 192, out: "public/icons/icon-maskable-192.png" },
  { input: maskableSvg, size: 512, out: "public/icons/icon-maskable-512.png" },
  { input: svg, size: 180, out: "src/app/apple-icon.png" },
];

await mkdir(path.join(ROOT, "public/icons"), { recursive: true });
for (const job of jobs) {
  const png = await sharp(Buffer.from(job.input)).resize(job.size, job.size).png().toBuffer();
  await writeFile(path.join(ROOT, job.out), png);
  console.log(`OK ${job.out} (${job.size}x${job.size}, ${png.length} bytes)`);
}
