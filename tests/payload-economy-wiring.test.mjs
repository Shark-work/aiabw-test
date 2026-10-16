/**
 * 契约测试 · PointsEconomy + TokenRules 读取侧接线（任务三/五：后台改经济参数前台同步）
 *
 *  A) /api/pet/chat：每日免费句数走 getTokenRuleByKey("pet.chat.free-quota")，
 *     非法/取不到回退 PET_CHAT_FREE_DAILY；响应下发 freeDaily（前端 total 不硬编码）；
 *  B) play/movie 聚合 API 下发 chatFreeDaily；双 client 展示 total 动态（缺省常量回退）；
 *  C) /points RSC 壳：getPointsEconomy + getTokenRuleList 白名单下发（敏感/内部字段
 *     不进 bundle）；客户端区块 = 经济四参数卡 + 规则列表（points 正负着色 + 每日上限）；
 *  D) 降级语义：economy=null 且 rules=[] → 区块整体隐藏（页面与接入前一致）；
 *     i18n 双语 parity；本测试已挂载。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ─────────────────────── A) chat 计费 CMS 化 ───────────────────────
test("economy-wiring(A): /api/pet/chat 免费句数走 CMS TokenRule + 常量回退 + freeDaily 下发", () => {
  const r = read("src/app/api/pet/chat/route.ts");
  assert.ok(r.includes('getTokenRuleByKey } from "@/lib/cms/loaders"'), "引入 loader");
  assert.ok(r.includes('getTokenRuleByKey("pet.chat.free-quota")'), "读 pet.chat.free-quota 规则");
  assert.ok(r.includes("freeRule?.dailyLimit && freeRule.dailyLimit > 0"), "非法值防护");
  assert.ok(r.includes(": PET_CHAT_FREE_DAILY"), "回退代码常量（计费永不崩）");
  assert.ok(r.includes("todayChats >= freeDaily"), "计费口径用 CMS 值");
  assert.ok(r.includes("freeDaily - todayChats - (refunded ? 0 : 1)"), "freeRemaining 同源");
  assert.ok(r.includes("freeDaily,"), "响应下发 freeDaily");
});

// ─────────────────────── B) 双 API 下发 + 双 client 展示 ───────────────────────
test("economy-wiring(B): play/movie 下发 chatFreeDaily + 双 client total 去硬编码", () => {
  for (const api of ["src/app/api/pet/play/route.ts", "src/app/api/pet/movie/route.ts"]) {
    const r = read(api);
    assert.ok(r.includes('getTokenRuleByKey("pet.chat.free-quota")'), `${api} 读规则`);
    assert.ok(r.includes("chatFreeDaily,"), `${api} 下发 chatFreeDaily`);
  }
  for (const ui of ["src/components/pet-play/pet-play-client.tsx", "src/components/pet-movie/pet-movie-client.tsx"]) {
    const c = read(ui);
    assert.ok(c.includes("PET_CHAT_FREE_DAILY"), `${ui} 缺省回退常量`);
    assert.ok(c.includes("data.chatFreeDaily"), `${ui} init 同步`);
    assert.ok(c.includes("data.freeDaily"), `${ui} chat 响应同步`);
    assert.ok(c.includes("total: chatFreeDaily"), `${ui} 展示 total 动态`);
    assert.ok(!c.includes("total: 5"), `${ui} 不再硬编码 total: 5`);
  }
});

// ─────────────────────── C) /points 壳 + 白名单 ───────────────────────
test("economy-wiring(C): /points RSC 壳白名单下发 + 客户端区块消费", () => {
  const p = read("src/app/[locale]/points/page.tsx");
  assert.ok(!p.includes('"use client"'), "壳为 RSC");
  assert.ok(p.includes("getPointsEconomy") && p.includes("getTokenRuleList"), "双 loader");
  assert.ok(p.includes("<PointsClient economy={ecoView} rules={ruleViews} />"), "props 下发");
  // 敏感字段红线：下发形状只含白名单展示字段
  for (const f of ["ruleKey", "nameZh", "nameEn", "points", "dailyLimit", "descriptionZh", "descriptionEn"]) {
    assert.ok(p.includes(f), `白名单字段 ${f}`);
  }
  assert.ok(!/ruleViews[\s\S]{0,300}(id|createdAt|updatedAt|cooldownMinutes):/.test(p), "内部字段不下发");
  const c = read("src/components/points/points-client.tsx");
  assert.ok(c.includes("export function PointsClient({"), "PointsClient 导出");
  assert.ok(c.includes("economy.signupBonus") && c.includes("economy.pointsPerCny"), "经济参数消费");
  assert.ok(c.includes("rules.map((r)"), "规则列表渲染");
  assert.ok(c.includes('t("ruleDailyLimit", { n: r.dailyLimit })'), "每日上限展示");
  assert.ok(c.includes("text-emerald-600") && c.includes("text-rose-500"), "正负积分着色");
  const loaders = read("src/lib/cms/loaders.ts");
  assert.ok(loaders.includes('sort: "ruleKey"'), "规则列表仅 enabled（loaders D 段已锁）+ ruleKey 排序");
});

// ─────────────────────── D) 降级 + i18n ───────────────────────
test("economy-wiring(D): 区块空态隐藏 + i18n 双语 parity + 本测试挂载", () => {
  const c = read("src/components/points/points-client.tsx");
  assert.ok(c.includes("(economy || rules.length > 0) &&"), "全空 → 区块隐藏（接入前一致）");
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  for (const k of ["economyTitle", "ecoSignupBonus", "ecoCheckinBase", "ecoStreakMax", "ecoPointsPerCny", "rulesTitle", "ruleDailyLimit"]) {
    assert.ok(zh.points[k], `zh.points.${k}`);
    assert.ok(en.points[k], `en.points.${k}`);
  }
  assert.ok(en.points.ruleDailyLimit.includes("{n}") && zh.points.ruleDailyLimit.includes("{n}"), "参数化 {n}");
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts.test.includes("payload-economy-wiring.test.mjs"), "已挂载 npm test");
});
