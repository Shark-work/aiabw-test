/**
 * Phase 7 批次 4 · 明信片分享优化契约测试（2026-10-16）
 * ----------------------------------------------------------------
 * 对应《实施计划》7.8 + Phase 7 指令 4（既有覆盖：7.8-2 社交分享按钮 / 7.8-4 好友明信片墙
 * / 7.8-5 分享图视觉已于 P2 社交传播批次落地）：
 *  A) 模板选择（7.8-1）：share.png 三模板 ?template= 注入 + 非法回退 classic；
 *     前端色块选择条 + localStorage 记忆 + 文件名带模板；
 *  B) 分享奖励（7.8-3）：POST /api/postcard-wall/share-reward 每日首次 +5 积分，
 *     points_log.ref='share-wall:{uid}:{date}' 唯一索引幂等防刷 + 事务化入账；
 *     前端分享成功后领取（已领/未登录静默）；
 *  C) i18n parity + 零 schema 红线。
 *
 * 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/postcard-share-phase7.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ───────────── A) 模板选择（7.8-1）─────────────
test("phase7d(A1): share.png——三模板主题 + ?template= 解析 + 非法回退 classic", () => {
  const r = read("../src/app/api/postcard-wall/[userId]/share.png/route.tsx");
  assert.match(r, /const SHARE_TEMPLATES: Record</, "模板表");
  for (const id of ["classic", "night", "blossom"]) {
    assert.match(r, new RegExp(`${id}: \\{\\s*bg: "linear-gradient`), `模板 ${id}`);
  }
  assert.match(r, /searchParams\.get\("template"\)/, "query 解析");
  assert.match(r, /SHARE_TEMPLATES\[templateParam\] \?\? SHARE_TEMPLATES\.classic/, "非法回退 classic");
  assert.match(r, /backgroundImage: tpl\.bg/, "背景渐变注入");
  assert.match(r, /color: tpl\.title/, "标题色注入");
  assert.match(r, /backgroundColor: tpl\.card/, "卡片底色注入");
});

test("phase7d(A2): 前端——色块选择条 + localStorage 记忆 + pngUrl 带模板参数", () => {
  const b = read("../src/components/exploration-v2/public-wall-share-button.tsx");
  assert.match(b, /const TEMPLATE_OPTIONS: \{ id: string; swatch: string \}\[\] = \[/, "模板选项");
  for (const id of ["classic", "night", "blossom"]) {
    assert.ok(b.includes(`{ id: "${id}"`), `选项 ${id}`);
  }
  assert.match(b, /localStorage\.getItem\(TEMPLATE_STORAGE_KEY\)/, "读取记忆");
  assert.match(b, /localStorage\.setItem\(TEMPLATE_STORAGE_KEY, id\)/, "写入记忆");
  assert.match(b, /share\.png\?template=\$\{template\}/, "pngUrl 带模板");
  assert.match(b, /`postcard-wall-\$\{template\}\.png`/, "下载文件名带模板");
  assert.match(b, /t\(`template\.\$\{o\.id\}`\)/, "模板名 i18n");
});

// ───────────── B) 分享奖励（7.8-3）─────────────
test("phase7d(B1): share-reward API——每日首次 +5 + ref 唯一幂等 + 事务化", () => {
  const r = read("../src/app/api/postcard-wall/share-reward/route.ts");
  assert.match(r, /getUserFromRequest/, "鉴权");
  assert.match(r, /status: 401/, "未登录 401");
  assert.match(r, /const SHARE_REWARD_POINTS = 5;/, "奖励 5 积分");
  assert.match(r, /VALUES \(\$1::uuid, \$2, 'share_reward',/, "reason=share_reward");
  assert.match(r, /'share-wall:' \|\| \$1::text \|\| ':' \|\| to_char\(now\(\), 'YYYY-MM-DD'\)/, "ref 含用户+当日（每日一次）");
  assert.match(r, /ON CONFLICT \(ref\) DO NOTHING/, "ref 唯一索引幂等");
  assert.match(r, /ins\.rowCount === 0[\s\S]*?rewarded: false/, "已领返回 rewarded=false");
  assert.match(r, /BEGIN[\s\S]*?UPDATE users SET points = points \+ \$2[\s\S]*?COMMIT/, "事务化入账");
  assert.match(r, /ROLLBACK/, "失败回滚");
});

test("phase7d(B2): 前端——分享成功后领取奖励 + rewarded 才提示 + 未登录静默", () => {
  const b = read("../src/components/exploration-v2/public-wall-share-button.tsx");
  assert.match(b, /await navigator\.share\(\{ files: \[file\], text \}\);\s*void claimShareReward\(\)/, "系统分享成功后领取");
  assert.match(b, /a\.click\(\);[\s\S]*?void claimShareReward\(\)/, "下载降级后也领取");
  assert.match(b, /fetch\("\/api\/postcard-wall\/share-reward", \{\s*method: "POST"/, "奖励端点");
  assert.match(b, /if \(!token\) return;/, "未登录静默");
  assert.match(b, /data\?\.ok && data\.rewarded[\s\S]*?shareReward", \{ points: data\.points \}\)\)/, "仅 rewarded 提示");
  assert.match(b, /setTimeout\(\(\) => setRewardTip\(null\), 4000\)/, "提示自动消失");
});

// ───────────── C) i18n parity + 零 schema ─────────────
test("phase7d(C1): i18n——templatePick/template.*/shareReward 双语 + api.shareRewardFailed", () => {
  const zh = JSON.parse(read("../messages/zh.json"));
  const en = JSON.parse(read("../messages/en.json"));
  const zw = zh.explorationV2.postcardWall;
  const ew = en.explorationV2.postcardWall;
  assert.ok(zw.templatePick && ew.templatePick, "templatePick 双语");
  assert.deepEqual(Object.keys(zw.template).sort(), Object.keys(ew.template).sort(), "template 三模板双语");
  assert.ok(zw.shareReward.includes("{points}") && ew.shareReward.includes("{points}"), "shareReward {points} 占位");
  assert.ok(zh.api.shareRewardFailed && en.api.shareRewardFailed, "api.shareRewardFailed 双语");
  const client = read("../src/db/client.ts");
  assert.match(client, /const SCHEMA_VERSION = 20;/, "SCHEMA_VERSION 本 Phase 无变更（20 由 Phase 8 提升）");
  const migrations = readdirSync(new URL("../drizzle", import.meta.url));
  assert.ok(!migrations.some((f) => /^003[6-9]|^00[4-9]\d/.test(f)), "无 0036+ 新迁移（0035 属 Phase 8）");
});
