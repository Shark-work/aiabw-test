/**
 * 契约测试 · Payload 数据迁移脚本（Commit 5 migration）
 *
 *  A) 脚本骨架：.env.local 加载 / 动态 import config / getPayload /
 *     幂等 upsert（find→update 全量覆盖 / create）/ 失败非零退出；
 *  B) 迁移映射完整性：七步迁移函数 + 五大数据源 import
 *     （SPECIES_VISUALS/MOOD_ACTION_MAP/worldview 五表/AIBI_ITEMS/messages 双语）；
 *  C) TokenRules 13 条额度与代码常量一致（签到/连签/分享/免费句数/裂变/徽章×8）；
 *  D) 红线：管理员不重置密码 / Pages·Banners 不虚构 / overrideAccess 服务端写入；
 *  E) PointsEconomy 默认值与现实一致（注册 20 / 汇率 ≈17 / 签到基准 3——曾误写 100 的回归锁）；
 *  F) cms:migrate 脚本封装（_paths-loader 解析 @/ 别名）+ 本测试挂载。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ─────────────────────── A) 骨架 ───────────────────────
test("payload-migrate(A): 脚本骨架（env 加载/动态 config/幂等 upsert/非零退出）", () => {
  const s = read("scripts/payload-migrate.mjs");
  assert.ok(s.includes('process.loadEnvFile?.(".env.local")'), ".env.local 加载");
  assert.ok(s.includes('await import("../payload.config.ts")'), "动态 import config（.ts 显式扩展名）");
  assert.ok(s.includes("getPayload({ config: await configPromise })"), "getPayload");
  assert.ok(s.includes("async function upsert("), "upsert 助手");
  assert.ok(s.includes('stats.update += 1') && s.includes('stats.create += 1'), "create/update 计数");
  assert.ok(s.includes("process.exit(1)"), "失败非零退出（CI 可感知）");
});

// ─────────────────────── B) 迁移映射完整性 ───────────────────────
test("payload-migrate(B): 七步迁移函数 + 五大数据源 import", () => {
  const s = read("scripts/payload-migrate.mjs");
  for (const fn of ["migrateAdmin", "migrateSpecies", "migratePetAnimations", "migrateStories", "migrateProducts", "migrateTokenRules", "migrateGlobals"]) {
    assert.ok(s.includes(`async function ${fn}(`), `函数 ${fn}`);
    assert.ok(s.includes(`await ${fn}()`), `主流程调用 ${fn}`);
  }
  for (const src of ["aibi-catalog.ts", "pets/characters.ts", "pets/sm-contract.ts", "pets/species-visuals.ts", "worldview-data.ts"]) {
    assert.ok(s.includes(src), `数据源 ${src}`);
  }
  assert.ok(s.includes('readFileSync("messages/zh.json"') && s.includes('readFileSync("messages/en.json"'), "messages 双语直读");
  // 世界观五表全量
  for (const t of ["WORLD_REGIONS", "WORLD_LIFE_FORMS", "WORLD_VALUES", "WORLD_GLOSSARY", "WORLD_ANCIENTS"]) {
    assert.ok(s.includes(t), `世界观表 ${t}`);
  }
});

// ─────────────────────── C) TokenRules 额度与代码一致 ───────────────────────
test("payload-migrate(C): TokenRules 13 条额度与代码常量一致", () => {
  const s = read("scripts/payload-migrate.mjs");
  const expected = [
    ["checkin.daily", 0, 1], ["checkin.streak-bonus", 100, 0], ["postcard.share", 5, 1],
    ["pet.chat.free-quota", 0, 5], ["referral.inviter", 50, 0],
    ["achievement.first-explore", 5, 0], ["achievement.explorer-10", 10, 0],
    ["achievement.all-common-events", 20, 0], ["achievement.all-rare-events", 30, 0],
    ["achievement.wiki-collector", 15, 0], ["achievement.bond-max", 25, 0],
    ["achievement.checkin-7", 35, 0], ["achievement.master", 100, 0],
  ];
  for (const [key, points, limit] of expected) {
    const re = new RegExp(`ruleKey: "${key.replace(".", "\\.")}"[\\s\\S]{0,200}points: ${points}, dailyLimit: ${limit}`);
    assert.ok(re.test(s), `${key} points=${points} dailyLimit=${limit}`);
  }
});

// ─────────────────────── D) 红线 ───────────────────────
test("payload-migrate(D): 管理员不重置密码 + Pages/Banners 不虚构 + overrideAccess", () => {
  const s = read("scripts/payload-migrate.mjs");
  assert.ok(s.includes("PAYLOAD_ADMIN_EMAIL") && s.includes("PAYLOAD_ADMIN_PASSWORD"), "管理员双 env 门控");
  assert.ok(s.includes("管理员已存在，跳过"), "已存在跳过（不重置密码）");
  assert.ok(s.includes("Pages/Banners 不虚构"), "Pages/Banners 留空红线");
  assert.ok(!s.includes('upsert(\n    "banners"') && !s.includes('collection: "banners"'), "无 banners 种子");
  assert.ok((s.match(/overrideAccess: true/g) ?? []).length >= 5, "迁移写入 overrideAccess");
});

// ─────────────────────── E) PointsEconomy 默认值回归锁 ───────────────────────
test("payload-migrate(E): PointsEconomy 默认值与现实一致（20/3/17 回归锁）", () => {
  const g = read("src/globals/PointsEconomy.ts");
  assert.ok(g.includes("defaultValue: 20"), "signupBonus 默认 20（注册 +20 口径）");
  assert.ok(g.includes("defaultValue: 3"), "checkinBase 默认 3（加权期望取整）");
  assert.ok(g.includes("defaultValue: 17"), "pointsPerCny 默认 17（基础档 100分/¥6）");
  assert.ok(!g.includes("defaultValue: 100"), "无误写的 100 默认值");
  const s = read("scripts/payload-migrate.mjs");
  assert.ok(s.includes("signupBonus: 20") && s.includes("pointsPerCny: 17"), "迁移种子值一致");
});

test("payload-migrate(F): SiteSettings 种子含读取侧接线四字段（留空回退不虚构）", () => {
  const s = read("scripts/payload-migrate.mjs");
  for (const f of ["logoUrl", "faviconUrl", "footerTextZh", "footerTextEn"]) {
    assert.ok(s.includes(`${f}: null`), `种子 ${f} 留空（前台回退默认，不虚构红线）`);
  }
  const g = read("src/globals/SiteSettings.ts");
  for (const f of ["logoUrl", "faviconUrl", "footerTextZh", "footerTextEn"]) {
    assert.ok(g.includes(`name: "${f}"`), `Global 字段 ${f} 与种子对齐`);
  }
});

// ─────────────────────── F) 脚本封装与挂载 ───────────────────────
test("payload-migrate(F): cms:migrate 封装 _paths-loader + 本测试挂载", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts["cms:migrate"], "cms:migrate 脚本");
  assert.ok(pkg.scripts["cms:migrate"].includes("--experimental-loader ./tests/_paths-loader.mjs"), "@/ 别名经 _paths-loader");
  assert.ok(pkg.scripts["cms:migrate"].includes("scripts/payload-migrate.mjs"), "入口脚本");
  assert.ok(pkg.scripts.test.includes("payload-migrate.test.mjs"), "本测试已挂载 npm test");
});
