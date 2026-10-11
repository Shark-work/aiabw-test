// 灵宠物种头像（2026-10 视觉重设）契约测试：
//   1) SPECIES_AVATARS 与 seed-pet-dictionary 26 物种严格一致（无漏项/无多余）
//   2) public/avatars/{id}.png 全部存在、512×512、RGBA（透明背景）
//   3) assets/avatars/{id}.svg 设计源齐全，且锁死扁平规范（禁渐变/滤镜/深色底）
//   4) speciesAvatarFor 纯函数行为（命中/未命中 null/空输入）
//   5) catalog + claim 读路径接线（命中映射覆盖 imageUrl，未命中回退 DB 原图）
// 离线可跑（PNG 解析仅读 IHDR 头，不依赖 sharp）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";

import { SPECIES_AVATARS, speciesAvatarFor } from "../src/lib/species-avatars.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const exists = (p) => existsSync(new URL(`../${p}`, import.meta.url));

/** 从 seed 脚本解析 26 个物种 id（单一事实源，避免两份清单漂移）。 */
function seedSpeciesIds() {
  const src = read("scripts/seed-pet-dictionary.cjs");
  const block = src.slice(src.indexOf("const SPECIES = ["), src.indexOf("];", src.indexOf("const SPECIES = [")));
  const ids = [...block.matchAll(/\{ id: "([a-z_]+)"/g)].map((m) => m[1]);
  return [...new Set(ids)].sort();
}

/** 解析 PNG IHDR：{ width, height, bitDepth, colorType }（colorType 6 = RGBA）。 */
function pngIhdr(buf) {
  assert.equal(buf.readUInt32BE(0), 0x89504e47, "PNG signature");
  assert.equal(buf.toString("ascii", 12, 16), "IHDR", "IHDR chunk");
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
  };
}

// ---- 1) 映射完整性 ----
test("species-avatars: 映射严格覆盖 seed 26 物种（无漏项、无多余）", () => {
  const expected = seedSpeciesIds();
  assert.equal(expected.length, 26, "seed 物种基数");
  assert.deepEqual(Object.keys(SPECIES_AVATARS).sort(), expected);
});

test("species-avatars: 映射值统一 /avatars/{id}.png 形态", () => {
  for (const [id, p] of Object.entries(SPECIES_AVATARS)) {
    assert.equal(p, `/avatars/${id}.png`, id);
  }
});

// ---- 2) PNG 产物 ----
test("species-avatars: 26 张 PNG 全部存在、512×512、RGBA 透明", () => {
  for (const id of Object.keys(SPECIES_AVATARS)) {
    const p = `public/avatars/${id}.png`;
    assert.ok(exists(p), `${p} missing（跑 scripts/build-avatars.mjs）`);
    const meta = pngIhdr(readFileSync(new URL(`../${p}`, import.meta.url)));
    assert.equal(meta.width, 512, id);
    assert.equal(meta.height, 512, id);
    assert.equal(meta.colorType, 6, `${id} 必须 RGBA（圆外透明背景）`);
  }
});

// ---- 3) SVG 设计源 + 扁平规范锁 ----
test("species-avatars: 26 个 SVG 源齐全且锁死扁平规范", () => {
  const files = readdirSync(new URL("../assets/avatars", import.meta.url)).filter((f) => f.endsWith(".svg"));
  assert.equal(files.length, 26, "SVG 源数量");
  for (const id of Object.keys(SPECIES_AVATARS)) {
    const svg = read(`assets/avatars/${id}.svg`);
    assert.match(svg, /viewBox="0 0 512 512"/, `${id} 画布`);
    assert.match(svg, /<circle cx="256" cy="256" r="246" fill="#[0-9A-Fa-f]{6}"\/>/, `${id} 圆形浅色底`);
    // 负向锁：禁渐变/滤镜（扁平矢量规范）
    assert.ok(!/linearGradient|radialGradient|<filter|feGaussianBlur|feDropShadow/.test(svg), `${id} 禁渐变/滤镜`);
    // 圆底色必须是浅色（RGB 三通道均值 ≥ 0xE0）
    const bg = svg.match(/<circle cx="256" cy="256" r="246" fill="#([0-9A-Fa-f]{6})"\/>/)[1];
    const lum = (parseInt(bg.slice(0, 2), 16) + parseInt(bg.slice(2, 4), 16) + parseInt(bg.slice(4, 6), 16)) / 3;
    assert.ok(lum >= 0xe0, `${id} 圆底 #${bg} 非浅色（lum=${lum.toFixed(0)}）`);
  }
});

// ---- 4) 纯函数行为 ----
test("speciesAvatarFor: 命中返回路径，未命中/空输入返回 null", () => {
  assert.equal(speciesAvatarFor("penguin"), "/avatars/penguin.png");
  assert.equal(speciesAvatarFor("hedgehog"), "/avatars/hedgehog.png");
  assert.equal(speciesAvatarFor("nonexistent_species"), null);
  assert.equal(speciesAvatarFor(""), null);
  assert.equal(speciesAvatarFor(null), null);
  assert.equal(speciesAvatarFor(undefined), null);
});

// ---- 5) 读路径接线 ----
test("contract: catalog 普通模式派生物种头像（聚合模式经 rep 自动继承）", () => {
  const src = read("src/app/api/pets/catalog/route.ts");
  assert.ok(src.includes('import { speciesAvatarFor } from "@/lib/species-avatars"'), "导入");
  assert.ok(src.includes("speciesAvatarFor(r.species_id) ?? r.image_url"), "普通模式覆盖 + DB 回退");
  assert.ok(src.includes("imageUrl: c.rep.imageUrl"), "聚合模式继承 rep（rep 来自已覆盖的 pets 数组）");
});

test("contract: claim 响应 pet 派生物种头像（链上 mint 不受影响）", () => {
  const src = read("src/app/api/pets/claim/route.ts");
  assert.ok(src.includes('import { speciesAvatarFor } from "@/lib/species-avatars"'), "导入");
  assert.ok(src.includes("speciesAvatarFor(pet.species_id) ?? pet.image_url"), "响应覆盖 + DB 回退");
});

test("contract: 构建脚本 sharp SVG→512 PNG 落位 public/avatars", () => {
  const src = read("scripts/build-avatars.mjs");
  assert.ok(src.includes('from "sharp"'), "sharp");
  assert.ok(src.includes('"assets", "avatars"'), "源目录");
  assert.ok(src.includes('"public", "avatars"'), "产物目录");
  assert.ok(src.includes("hasAlpha"), "alpha 校验");
});
