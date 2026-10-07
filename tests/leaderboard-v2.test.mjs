// 产品升级 Phase 5（排行榜与社交强化）契约测试：
//  1) lib：多维榜单常量 + periodStart 纯函数 + 推荐位定价；
//  2) /api/leaderboard 增强：category × period 四类榜 + myRank + promoted 集成 + 向后兼容红线（type=pets|breeders 原路径）；
//  3) 推荐曝光：POST /api/content/promote（advisory lock 串行 + 防重 409 + 402 needed + 事务 + 流水）+ GET targets + GET /api/content/promoted；
//  4) 前端：独立页 /leaderboard + LeaderboardV2（分类/周期 Tab、前三奖牌卡、推荐位区、myRank 横幅、分享按钮）+ PromoteModal（402 接 Phase 4 事件总线）；
//  5) 指令 4：收藏中心 NFR 卡片「推广」链接直达 /leaderboard?promote=<实例id>；
//  6) i18n 双语 parity + 零 schema 变更红线（promoted_content 表 v19 已就位）。
// 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/leaderboard-v2.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

import {
  LEADERBOARD_CATEGORIES,
  LEADERBOARD_PERIODS,
  periodStart,
  startOfWeek,
  PROMOTE_CONTENT_TYPE,
  PROMOTE_DAYS,
  PROMOTE_PRICING,
  PROMOTED_SLOT_LIMIT,
} from "../src/lib/leaderboard.ts";


const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// === 1) lib 常量与 periodStart ===
test("lib: 4 分类 × 4 周期常量", () => {
  assert.deepEqual([...LEADERBOARD_CATEGORIES], ["popularity", "collection", "exploration", "creation"]);
  assert.deepEqual([...LEADERBOARD_PERIODS], ["day", "week", "month", "all"]);
});

test("lib: periodStart day=今日0点 / week=周一 / month=1号 / all=null", () => {
  const now = new Date(2026, 9, 14, 15, 30, 0); // 2026-10-14 周三
  const day = periodStart("day", now);
  assert.equal(day.getHours(), 0);
  assert.equal(day.getDate(), 14);
  const week = periodStart("week", now);
  assert.equal(week.getTime(), startOfWeek(now).getTime());
  assert.equal(week.getDate(), 12); // 本周一 10-12
  const month = periodStart("month", now);
  assert.equal(month.getDate(), 1);
  assert.equal(month.getHours(), 0);
  assert.equal(periodStart("all", now), null);
});

test("lib: 推荐位定价 1/3/7 天 = 100/250/500，坑位 3，content_type=collectible", () => {
  assert.deepEqual([...PROMOTE_DAYS], [1, 3, 7]);
  assert.equal(PROMOTE_PRICING[1], 100);
  assert.equal(PROMOTE_PRICING[3], 250);
  assert.equal(PROMOTE_PRICING[7], 500);
  assert.equal(PROMOTED_SLOT_LIMIT, 3);
  assert.equal(PROMOTE_CONTENT_TYPE, "collectible");
});

// === 2) /api/leaderboard 增强 ===
test("api/leaderboard: category 分支 + period 校验回退 week + 可选鉴权 myRank", () => {
  const src = read("../src/app/api/leaderboard/route.ts");
  assert.match(src, /searchParams\.get\("category"\)/);
  assert.match(src, /LEADERBOARD_CATEGORIES as readonly string\[\]/);
  assert.match(src, /handleCategoryBoard\(req, locale, anonName/);
  assert.match(src, /searchParams\.get\("period"\) \?\? "week"/);
  // 可选鉴权（未登录不 401）
  assert.match(src, /getUserFromRequest\(req\)\.catch\(\(\) => null\)/);
  assert.match(src, /myRank/);
});

test("api/leaderboard: 四类榜数据源 + opt-out 过滤全覆盖", () => {
  const src = read("../src/app/api/leaderboard/route.ts");
  assert.match(src, /user_collectibles uc/);
  assert.match(src, /exploration_records er/);
  assert.match(src, /ugc_creations ug/);
  // popularity=战力榜 + breeders 旧榜 + collection/exploration/creation 三榜均需 opt-out 过滤
  const optOuts = src.match(/show_in_leaderboard = true/g) ?? [];
  assert.ok(optOuts.length >= 4, `opt-out 过滤应 >=4 处（pets/breeders/count榜主查询+higher子查询），命中 ${optOuts.length}`);
  // 人气榜 period 固定回显 all（战力累计口径）
  assert.match(src, /effectivePeriod = "all"/);
  // 脱敏投影
  assert.ok(!/ownerEmail|u\.email/.test(src), "不得查询/输出邮箱");
  assert.match(src, /toPublicOwner/);
});

test("api/leaderboard: myRank 计算（popularity 候选集定位 + count 类 higher+1）", () => {
  const src = read("../src/app/api/leaderboard/route.ts");
  assert.match(src, /ranked\.findIndex\(\(r\) => r\.ownerId === user\.id\)/);
  assert.match(src, /HAVING count\(\*\) > \$2/);
  assert.match(src, /rank: Number\(higher\.rows\[0\]\?\.n \?\? 0\) \+ 1/);
});

test("api/leaderboard: 集成 promoted（loadActivePromotions countView）且向后兼容旧 type 路径", () => {
  const src = read("../src/app/api/leaderboard/route.ts");
  assert.match(src, /loadActivePromotions\(locale, anonName, \{ countView: true \}\)/);
  // 旧契约红线：type=pets / type=breeders 原响应结构保留
  assert.match(src, /\{ ok: true, type: "pets", items \}/);
  assert.match(src, /type: "breeders",/);
  assert.match(src, /type === "breeders"/);
});

// === 3) 推荐曝光 API ===
test("promotions lib: 生效窗口 + priority 排序 + views 累计 + 公开投影", () => {
  const src = read("../src/lib/promotions.ts");
  assert.match(src, /pc\.start_time <= now\(\) AND pc\.end_time > now\(\)/);
  assert.match(src, /ORDER BY pc\.priority DESC, pc\.created_at ASC/);
  assert.match(src, /UPDATE promoted_content SET views = views \+ 1 WHERE id = ANY/);
  assert.match(src, /toPublicOwner/);
  assert.ok(!/email|phone/.test(src), "DTO 不得含邮箱/手机号");
  // 我的记录（含过期）
  assert.match(src, /loadMyPromotions/);
  assert.match(src, /pc\.promoter_id = \$1::uuid/);
});

test("promote POST: 归属校验 404/403/400 + advisory lock + 防重 409 + 402 needed", () => {
  const src = read("../src/app/api/content/promote/route.ts");
  assert.match(src, /apiError\(locale, "signInFirst"\)[\s\S]{0,60}\{ status: 401 \}/);
  assert.match(src, /apiError\(locale, "collectibleNotFound"\)[\s\S]{0,60}\{ status: 404 \}/);
  assert.match(src, /apiError\(locale, "noPermissionPet"\)[\s\S]{0,60}\{ status: 403 \}/);
  assert.match(src, /apiError\(locale, "collectibleInactive"\)[\s\S]{0,60}\{ status: 400 \}/);
  // 并发串行化 + 生效窗口防重（先防重后扣分，409 不扣钱）
  assert.match(src, /pg_advisory_xact_lock\(hashtext/);
  assert.match(src, /end_time > now\(\)[\s\S]{0,500}status: 409/);
  assert.match(src, /error: "already_promoted"/);
  // 原子扣分防负
  assert.match(src, /UPDATE users SET points = points - \$2 WHERE id = \$1::uuid AND points >= \$2/);
  assert.match(src, /error: "insufficient_points", needed: cost[\s\S]{0,40}\{ status: 402 \}/);
});

test("promote POST: 事务闭环 + 推广记录（priority=days + make_interval）+ 积分流水", () => {
  const src = read("../src/app/api/content/promote/route.ts");
  assert.match(src, /await client\.query\("BEGIN"\)/);
  assert.match(src, /await client\.query\("COMMIT"\)/);
  assert.match(src, /ROLLBACK/);
  assert.match(src, /INSERT INTO promoted_content/);
  assert.match(src, /now\(\) \+ make_interval\(days => \$4\)/);
  // priority = days（时长越长坑位越靠前）：VALUES 第 4 参同时供 end_time 与 priority
  assert.match(src, /VALUES \(\$1, \$2::uuid, \$3::uuid, now\(\), now\(\) \+ make_interval\(days => \$4\), \$4\)/);
  assert.match(src, /INSERT INTO points_log \(user_id, amount, reason, ref\) VALUES \(\$1::uuid, \$2, 'promote', \$3\)/);
  assert.match(src, /`promote:\$\{promotion\.id\}`/);
  // 价格与服务端常量同源（前端不硬编码）
  assert.match(src, /PROMOTE_PRICING\[days\]/);
});

test("promote GET targets + promoted GET（公共 / mine=1）", () => {
  const promote = read("../src/app/api/content/promote/route.ts");
  // Phase 6：EXISTS 升级为 LEFT JOIN LATERAL（取生效推广 id/到期时间供提前下架），窗口过滤条件不变
  assert.match(promote, /LEFT JOIN LATERAL \([\s\S]{0,150}promoted_content pc[\s\S]{0,200}pc\.content_id = uc\.id AND pc\.end_time > now\(\)/);
  assert.match(promote, /pricing: PROMOTE_DAYS\.map/);
  const promoted = read("../src/app/api/content/promoted/route.ts");
  assert.match(promoted, /searchParams\.get\("mine"\) === "1"/);
  assert.match(promoted, /loadMyPromotions\(user\.id/);
  assert.match(promoted, /loadActivePromotions\(locale, anonName, \{ countView: true \}\)/);
});

// === 4) 前端 ===
test("leaderboard 独立页 + LeaderboardV2 多维 UI 契约", () => {
  const page = read("../src/app/[locale]/leaderboard/page.tsx");
  assert.match(page, /<LeaderboardV2 \/>/);
  const c = read("../src/components/leaderboard-v2.tsx");
  // 分类/周期 Tab 由 lib 常量驱动
  assert.match(c, /LEADERBOARD_CATEGORIES\.map/);
  assert.match(c, /LEADERBOARD_PERIODS\.map/);
  assert.match(c, /data-testid=\{`cat-tab-\$\{c\}`\}/);
  assert.match(c, /data-testid=\{`period-tab-\$\{p\}`\}/);
  // 人气榜隐藏周期 Tab（累计口径）
  assert.match(c, /\{!isPetBoard && \(/);
  // 前三奖牌卡 + 紧凑列表 + 分享按钮
  assert.match(c, /data-testid=\{`rank-card-\$\{item\.rank\}`\}/);
  assert.match(c, /data-testid=\{`rank-row-\$\{item\.rank\}`\}/);
  assert.match(c, /data-testid=\{`share-rank-\$\{item\.rank\}`\}/);
  assert.match(c, /navigator\.share/);
  assert.match(c, /navigator\.clipboard\.writeText/);
  // 推荐位区 + myRank 横幅 + 推广 CTA
  assert.match(c, /data-testid="promoted-section"/);
  assert.match(c, /data-testid=\{`promoted-slot-\$\{i\}`\}/);
  assert.match(c, /data-testid="my-rank-banner"/);
  assert.match(c, /data-testid="promote-open-btn"/);
  // ?promote=<id> 直达 + Bearer 鉴权请求（myRank）
  assert.match(c, /\.get\("promote"\)/);
  assert.match(c, /Authorization: `Bearer \$\{token\}`/);
  assert.match(c, /<PromoteModal/);
});

test("PromoteModal: targets 加载 + 档位选择 + 402 接 Phase 4 事件总线 + 409 处理", () => {
  const m = read("../src/components/promote-modal.tsx");
  assert.match(m, /fetch\("\/api\/content\/promote"/);
  assert.match(m, /data-testid=\{`promote-target-\$\{pet\.id\}`\}/);
  assert.match(m, /data-testid=\{`promote-days-\$\{p\.days\}`\}/);
  assert.match(m, /data-testid="promote-confirm"/);
  assert.match(m, /import \{ notifyPointsInsufficient \} from "@\/lib\/points-entry"/);
  assert.match(m, /res\.status === 402[\s\S]{0,150}notifyPointsInsufficient\(\{ needed: Number\(d\?\.needed \?\? cost\) \}\)/);
  assert.match(m, /res\.status === 409 \|\| d\?\.error === "already_promoted"/);
  // 推广中藏品置灰防重复购买
  assert.match(m, /disabled=\{pet\.promoting\}/);
});

test("指令 4：NFR 卡片「推广」链接直达 + SiteHeader 导航入口", () => {
  const panel = read("../src/components/collection/nfr-gallery-panel.tsx");
  assert.match(panel, /href=\{`\/leaderboard\?promote=\$\{myInstances\[0\]\.id\}`\}/);
  assert.match(panel, /data-testid="nfr-promote-link"/);
  assert.match(panel, /t\("actions\.promote"\)/);
  const header = read("../src/components/layout/SiteHeader.tsx");
  assert.match(header, /href: "\/leaderboard", label: t\("navLeaderboard"\)/);
});


// === 5) i18n 双语 parity ===
test("i18n: leaderboard 新 key + promote 命名空间 zh/en 深键 parity", () => {
  const zh = JSON.parse(read("../messages/zh.json"));
  const en = JSON.parse(read("../messages/en.json"));
  const deepKeys = (o, p = "") =>
    Object.entries(o ?? {}).flatMap(([k, v]) =>
      v && typeof v === "object" ? deepKeys(v, `${p}${k}.`) : [`${p}${k}`],
    );
  const zk = deepKeys(zh.leaderboard).sort();
  const ek = deepKeys(en.leaderboard).sort();
  assert.deepEqual(zk, ek, "leaderboard zh/en 键集合一致");
  assert.deepEqual(deepKeys(zh.promote).sort(), deepKeys(en.promote).sort(), "promote zh/en 键集合一致");
  // 关键 key 存在
  for (const k of ["catPopularity", "catCollection", "catExploration", "catCreation", "periodDay", "periodAll", "myRankBanner", "promotedTitle", "promoteCta", "share", "shared", "empty", "endsAt"]) {
    assert.ok(zh.leaderboard[k] && en.leaderboard[k], `leaderboard.${k} 双语`);
  }
  for (const k of ["title", "selectPet", "noPets", "promoting", "days", "cost", "confirm", "success", "insufficient", "alreadyPromoted", "note", "signInRequired"]) {
    assert.ok(zh.promote[k] && en.promote[k], `promote.${k} 双语`);
  }
  // 旧 key 不受破坏（bond-crystal 锚定值）
  assert.equal(zh.leaderboard.tabBreeders, "结晶达人");
  assert.equal(en.leaderboard.tabBreeders, "Top Crystallizers");
  // 增补 key
  assert.ok(zh.nav.navLeaderboard && en.nav.navLeaderboard, "nav.navLeaderboard 双语");
  assert.ok(zh.api.promoteInvalidRequest && en.api.promoteInvalidRequest, "api.promoteInvalidRequest 双语");
  assert.equal(zh.collection.nfr.actions.promote, "推广");
  assert.equal(en.collection.nfr.actions.promote, "Promote");
});

test("i18n: 占位符 zh/en 一致（{rank}/{n}/{cost}/{slots}/{end}/{time}/{name}/{owner}）", () => {
  const zh = JSON.parse(read("../messages/zh.json"));
  const en = JSON.parse(read("../messages/en.json"));
  const holders = [
    ["leaderboard", "myRankBanner", ["rank"]],
    ["leaderboard", "endsAt", ["time"]],
    ["leaderboard", "shareTextPet", ["rank", "owner", "name"]],
    ["leaderboard", "shareTextUser", ["rank", "name"]],
    ["promote", "days", ["n"]],
    ["promote", "cost", ["cost"]],
    ["promote", "success", ["end"]],
    ["promote", "note", ["slots"]],
  ];
  for (const [ns, key, params] of holders) {
    for (const p of params) {
      assert.ok(zh[ns][key].includes(`{${p}}`), `zh ${ns}.${key} 含 {${p}}`);
      assert.ok(en[ns][key].includes(`{${p}}`), `en ${ns}.${key} 含 {${p}}`);
    }
  }
});

// === 6) 零 schema 变更红线 ===
test("schema 红线：无新迁移 + SCHEMA_VERSION 无 Phase 5 变更（20 由 Phase 8 提升）+ 源码无 DDL", () => {
  const migrations = readdirSync(new URL("../drizzle", import.meta.url)).filter((f) => f.endsWith(".sql"));
  assert.ok(
    !migrations.some((f) => /003[7-9]|leaderboard|promote/.test(f)),
    `不得出现 Phase 5 新迁移（0035 属 Phase 8）：${migrations.filter((f) => /003[7-9]|leaderboard|promote/.test(f)).join(",")}`,
  );
  const client = read("../src/db/client.ts");
  assert.match(client, /const SCHEMA_VERSION = 21;/);
  for (const f of ["../src/app/api/content/promote/route.ts", "../src/app/api/content/promoted/route.ts", "../src/app/api/leaderboard/route.ts", "../src/lib/promotions.ts"]) {
    assert.ok(!/CREATE TABLE|ALTER TABLE/.test(read(f)), `${f} 不得含 DDL`);
  }
  // promoted_content 表（v19）已就位，本期直接消费
  assert.ok(existsSync(new URL("../drizzle/0034_monetization.sql", import.meta.url)), "0034 迁移在位");
  assert.match(client, /CREATE TABLE IF NOT EXISTS "promoted_content"/);
});

// === 7) 空数据/字段缺失防护（2026-10-16 生产白屏事故修复锁定） ===
// 事故：collection（CountItem，无 power）切 popularity 分类时，setCategory 同步重渲先于 useEffect，
// 旧 items 在 isPetBoard 分支渲染一帧 → undefined.toLocaleString() TypeError 白屏。
test("竞态防护：分类/周期切换的同步 onClick 路径必须先清空 items+myRank 再 setState", () => {
  const src = read("../src/components/leaderboard-v2.tsx");
  // 分类 tab：setItems([]) → setMyRank(null) → setCategory(c) 顺序
  const catHandler = src.match(/data-testid=\{`cat-tab-\$\{c\}`\}[\s\S]*?onClick=\{\(\) => \{([\s\S]*?)\}\}/);
  assert.ok(catHandler, "cat tab handler exists");
  const h = catHandler[1];
  assert.ok(h.includes("setItems([])"), "cat switch clears items");
  assert.ok(h.includes("setMyRank(null)"), "cat switch clears myRank");
  assert.ok(
    h.indexOf("setItems([])") < h.indexOf("setCategory(c)"),
    "clear items BEFORE setCategory (sync path)",
  );
  // 周期 tab 同防护
  const periodHandler = src.match(/data-testid=\{`period-tab-\$\{p\}`\}[\s\S]*?onClick=\{\(\) => \{([\s\S]*?)\}\}/);
  assert.ok(periodHandler, "period tab handler exists");
  assert.ok(periodHandler[1].includes("setItems([])"), "period switch clears items");
  assert.ok(periodHandler[1].indexOf("setItems([])") < periodHandler[1].indexOf("setPeriod(p)"), "clear before setPeriod");
});

test("空值保护：排行榜组件所有数值渲染点带 ?? 0 兜底（pet.power/myRank.value/item.power/count）", () => {
  const src = read("../src/components/leaderboard-v2.tsx");
  // 不允许裸调用：identifier.toLocaleString( 前面必须有 ?? 0)
  const bare = src.match(/(?<!\?\? 0\)\()\b\w+(?:\.\w+)*\.toLocaleString\(\)/g) ?? [];
  assert.deepEqual(bare, [], `存在未兜底的 toLocaleString 调用：${bare.join(", ")}`);
  // 四个数值渲染点显式断言
  assert.ok(src.includes("(pet.power ?? 0).toLocaleString()"), "top card power guarded");
  assert.ok(src.includes("(myRank.value ?? 0).toLocaleString()"), "myRank value guarded");
  assert.ok(src.includes("(item.power ?? 0).toLocaleString()"), "row power guarded");
  assert.ok(src.includes("((item as CountItem).count ?? 0).toLocaleString()"), "top card count guarded");
  assert.ok(src.includes("(item.count ?? 0).toLocaleString()"), "row count guarded");
});

test("空数据安全：items/myRank/promoted 响应字段缺失时客户端状态兜底为空", () => {
  const src = read("../src/components/leaderboard-v2.tsx");
  assert.ok(src.includes("setItems(d.items ?? [])"), "items fallback []");
  assert.ok(src.includes("setPromoted(d.promoted ?? [])"), "promoted fallback []");
  assert.ok(src.includes("setMyRank(d.myRank ?? null)"), "myRank fallback null");
  // myRank 横幅渲染有条件保护（null 不渲染）
  assert.ok(src.includes("{myRank && ("), "myRank banner conditional");
  // 空列表走 empty 文案分支而非渲染卡片
  assert.ok(src.includes("items.length === 0"), "empty branch exists");
  // API 端：计数榜 myCount 与 power 计算恒为 number（petPower ?? 10 稀有度兜底）
  const lib = read("../src/lib/leaderboard.ts");
  assert.ok(lib.includes('RARITY_POWER[rarity ?? ""] ?? 10'), "petPower rarity fallback");
  const route = read("../src/app/api/leaderboard/route.ts");
  assert.ok(route.includes("Number(mine.rows[0]?.cnt ?? 0)"), "myCount fallback 0");
  // API 端 JOIN 均为 INNER（清理用户后无悬空引用行混入榜单）
  assert.ok(!/LEFT JOIN/i.test(route), "no LEFT JOIN in leaderboard route");
});

