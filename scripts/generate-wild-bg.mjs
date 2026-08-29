// 生成「野性山林」背景图：SVG 矢量剪影（远山 + 近林 + 暖光洞穴）→ Sharp 转 WebP（<200KB）
// 用法: node scripts/generate-wild-bg.mjs
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const W = 1920;
const H = 1080;

const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#232f3e"/>
      <stop offset="0.55" stop-color="#1c2e33"/>
      <stop offset="1" stop-color="#16352c"/>
    </linearGradient>
    <radialGradient id="caveglow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffd700" stop-opacity="0.95"/>
      <stop offset="0.35" stop-color="#ffd700" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#ffd700" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mist" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7fa396" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#7fa396" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#7fa396" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- 天空 -->
  <rect width="${W}" height="${H}" fill="url(#sky)"/>

  <!-- 远山剪影 -->
  <path d="M0,560 L160,380 L330,560 L520,330 L720,560 L900,400 L1080,560 L1260,350 L1440,560 L1600,420 L1760,560 L1920,470 L1920,1080 L0,1080 Z" fill="#1a2b30"/>
  <path d="M0,640 L220,470 L430,640 L650,500 L860,640 L1080,480 L1300,640 L1520,520 L1740,640 L1920,560 L1920,1080 L0,1080 Z" fill="#142120"/>

  <!-- 近处山林轮廓（树冠剪影） -->
  <g fill="#0d1a15">
    <path d="M0,820 Q60,760 120,820 Q180,770 240,820 Q300,760 360,820 L360,1080 L0,1080 Z"/>
    <path d="M300,860 Q360,800 420,860 Q480,810 540,860 Q600,790 660,860 L660,1080 L300,1080 Z"/>
    <path d="M580,840 Q640,780 700,840 Q760,790 820,840 Q880,770 940,840 L940,1080 L580,1080 Z"/>
    <path d="M880,870 Q940,800 1000,870 Q1060,810 1120,870 Q1180,790 1240,870 L1240,1080 L880,1080 Z"/>
    <path d="M1180,850 Q1240,790 1300,850 Q1360,800 1420,850 Q1480,780 1540,850 L1540,1080 L1180,1080 Z"/>
    <path d="M1500,830 Q1560,770 1620,830 Q1680,780 1740,830 Q1800,760 1860,830 L1860,1080 L1500,1080 Z"/>
    <path d="M1780,860 L1920,800 L1920,1080 L1780,1080 Z"/>
  </g>

  <!-- 山腰薄雾 -->
  <rect y="700" width="${W}" height="120" fill="url(#mist)"/>

  <!-- 洞穴：洞口 + 暖光 -->
  <ellipse cx="1570" cy="940" rx="86" ry="52" fill="#060a08"/>
  <circle cx="1570" cy="940" r="190" fill="url(#caveglow)"/>
  <ellipse cx="1570" cy="936" rx="44" ry="26" fill="#ffd700" opacity="0.9"/>
  <ellipse cx="1570" cy="942" rx="58" ry="36" fill="#0a0f0c"/>
</svg>`;

const outDir = path.join(process.cwd(), "public", "images");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "wild-bg.webp");
const buf = await sharp(Buffer.from(svg)).resize(W, H).webp({ quality: 72 }).toBuffer();
fs.writeFileSync(out, buf);
const sizeKb = Math.round(buf.length / 1024);
console.log(`OK wild-bg.webp (${W}x${H}) ${sizeKb}KB ${sizeKb < 200 ? "PASS" : "TOO BIG"}`);
