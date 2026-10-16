/**
 * 契约测试 · Payload Globals（Commit 3 globals）
 *
 *  A) 三 Global 注册进 payload.config（.ts 显式扩展名红线 + globals 数组）；
 *  B) 字段契约：SiteSettings（品牌/联系/备案/维护模式）↔ contact 命名空间镜像、
 *     HomeHero（标题/副标题/三 CTA/背景/灵魂树开关）↔ home.* i18n 镜像、
 *     PointsEconomy（注册赠送/签到/连签封顶/充值汇率/经济说明 richText）；
 *  C) 统一 Global 访问策略（读公开 + update 仅 admin；Global 无 create/delete）；
 *  D) 生成物含三 Global 类型；本测试已挂载。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const THREE = ["SiteSettings", "HomeHero", "PointsEconomy"];

// ─────────────────────── A) 注册 ───────────────────────
test("payload-globals(A): 三 Global 全部注册且导入带 .ts 扩展名", () => {
  const cfg = read("payload.config.ts");
  for (const name of THREE) {
    assert.ok(cfg.includes(`import { ${name} } from "./src/globals/${name}.ts"`), `${name} 导入带 .ts`);
    assert.ok(!cfg.includes(`from "./src/globals/${name}"`), `${name} 禁止无扩展名导入`);
  }
  const arrMatch = cfg.match(/globals:\s*\[([^\]]+)\]/);
  assert.ok(arrMatch, "globals 数组存在");
  for (const name of THREE) {
    assert.ok(arrMatch[1].includes(name), `globals 数组含 ${name}`);
  }
});

// ─────────────────────── B) 字段契约 ───────────────────────
test("payload-globals(B1): SiteSettings 品牌/联系/备案/维护模式", () => {
  const g = read("src/globals/SiteSettings.ts");
  assert.ok(g.includes('slug: "site-settings"'), "slug");
  for (const f of ["siteNameZh", "siteNameEn", "sloganZh", "sloganEn", "contactEmail", "qqGroup", "xUrl", "icpNumber", "maintenanceMode", "maintenanceMessageZh", "maintenanceMessageEn"]) {
    assert.ok(g.includes(`name: "${f}"`), `字段 ${f}`);
  }
  assert.ok(g.includes("defaultValue: false"), "维护模式默认关闭");
});

test("payload-globals(B2): HomeHero 三 CTA + 背景双轨 + 灵魂树开关", () => {
  const g = read("src/globals/HomeHero.ts");
  assert.ok(g.includes('slug: "home-hero"'), "slug");
  for (const f of ["titleZh", "titleEn", "subtitleZh", "subtitleEn", "ctaPrimaryTextZh", "ctaPrimaryUrl", "ctaExploreTextZh", "ctaExploreUrl", "ctaShopTextZh", "ctaShopUrl", "backgroundImage", "backgroundPath", "soulTreeEnabled"]) {
    assert.ok(g.includes(`name: "${f}"`), `字段 ${f}`);
  }
  assert.ok(g.includes('relationTo: "media"'), "背景图 Media 上传");
  assert.ok(g.includes("defaultValue: true"), "灵魂树彩蛋默认开");
});

test("payload-globals(B3): PointsEconomy 宏观四参数 + richText 经济说明", () => {
  const g = read("src/globals/PointsEconomy.ts");
  assert.ok(g.includes('slug: "points-economy"'), "slug");
  for (const f of ["signupBonus", "checkinBase", "checkinStreakMax", "pointsPerCny", "descriptionZh", "descriptionEn"]) {
    assert.ok(g.includes(`name: "${f}"`), `字段 ${f}`);
  }
  assert.ok((g.match(/type: "richText"/g) ?? []).length === 2, "双语 richText 经济说明");
  assert.ok(g.includes("min: 1"), "汇率 min 1（防通胀）");
});

// ─────────────────────── C) 访问策略 ───────────────────────
test("payload-globals(C): 三 Global 统一 publicReadAdminWriteGlobal", () => {
  const access = read("src/collections/access.ts");
  assert.ok(access.includes("publicReadAdminWriteGlobal"), "Global 策略导出");
  assert.ok(access.includes("update: isAdmin"), "update 仅 admin");
  assert.ok(!access.match(/publicReadAdminWriteGlobal[\s\S]*create:/), "Global 无 create/delete");
  for (const name of THREE) {
    const g = read(`src/globals/${name}.ts`);
    assert.ok(g.includes('from "../collections/access.ts"'), `${name} 引入公共 access`);
    assert.ok(g.includes("access: publicReadAdminWriteGlobal"), `${name} 应用 Global 策略`);
  }
});

// ─────────────────────── D) 生成物与挂载 ───────────────────────
test("payload-globals(D): payload-types 含三 Global + 本测试已挂载", () => {
  const t = read("src/payload-types.ts");
  for (const slug of ["site-settings", "home-hero", "points-economy"]) {
    assert.ok(t.includes(slug), `payload-types 含 ${slug}`);
  }
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts.test.includes("payload-globals.test.mjs"), "已挂载 npm test");
});
