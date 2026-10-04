// 双页合并契约测试（2026-10-09，backlog P2：/my-pets 与 /pets/my 合并）
//  1) Tab 壳：/pets/my 引入双面板 + Tab 切换 + 懒挂载状态保留 + 未登录跳转 + 深链；
//  2) companion-panel：伙伴能力完整保留（/api/pets、记忆、背包装备、装扮商城、邀请、PushOptIn），无互跳条/页面壳；
//  3) collection-panel：收藏能力完整保留（catalog?mine=1、融合、放生、兑换），无互跳条/页面壳/未登录跳转；
//  4) /my-pets 308 → /pets/my + 全站业务代码无 /my-pets 残留引用；
//  5) i18n：tabCompanion/tabCollection 双语新增 + evolveBanner/crossBanner 互跳条键清除；
//  6) 引用统一：SiteHeader/sitemap/points/handbooks/marketplace/首页 redirect 全指向 /pets/my。
// 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/my-pets-merge.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), "utf8");

test("merge(1): /pets/my Tab 壳（双面板 + 懒挂载 + 未登录跳转 + 深链）", () => {
  const shell = read("../src/app/[locale]/pets/my/page.tsx");
  assert.match(shell, /import \{ CompanionPanel \} from "@\/components\/pets\/companion-panel"/);
  assert.match(shell, /import \{ CollectionPanel \} from "@\/components\/pets\/collection-panel"/);
  assert.match(shell, /tabCompanion/);
  assert.match(shell, /tabCollection/);
  // 懒挂载 + 状态保留（visited 集合 + hidden 切换）
  assert.match(shell, /visited\.has\("companion"\)/);
  assert.match(shell, /visited\.has\("collection"\)/);
  assert.match(shell, /"hidden"/);
  // 未登录跳转（原 /pets/my 行为，壳层统一承担）
  assert.match(shell, /aiabw_token/);
  assert.match(shell, /\/login\?redirect=\/pets\/my/);
  // 深链：?tab=collection / ?rarity=（图鉴稀有度筛选历史入口）→ 收藏 Tab
  assert.match(shell, /qs\.get\("tab"\) === "collection"/);
  assert.match(shell, /qs\.get\("rarity"\)/);
});

test("merge(2): companion-panel 伙伴能力完整保留，无互跳条/页面壳", () => {
  const p = read("../src/components/pets/companion-panel.tsx");
  assert.match(p, /export function CompanionPanel\(\)/);
  // 核心能力：聊天宠物数据源 / 记忆管理 / 背包装备 / 装扮商城 / 邀请码 / Push 召回 / 排序搜索
  for (const marker of [
    "/api/pets?anonymousId=",
    "/api/memory",
    "/api/user/items/equip",
    "CosmeticsShopModal",
    "PushOptIn",
    "inviteCode",
    "sortHappiness",
    "pet.displayName || pet.petName",
  ]) {
    assert.ok(p.includes(marker), `companion-panel 缺失能力标记: ${marker}`);
  }
  // 互跳条与页面壳已移除（h1 由 Tab 壳统一提供；按代码引用断言，注释中的历史说明不误伤）
  assert.ok(!p.includes('t("evolveBanner")'), "互跳条 evolveBanner 引用必须移除");
  assert.ok(!p.includes("<main"), "面板不得再含页面级 <main> 壳");
});

test("merge(3): collection-panel 收藏能力完整保留，无互跳条/页面壳/未登录跳转", () => {
  const p = read("../src/components/pets/collection-panel.tsx");
  assert.match(p, /export function CollectionPanel\(\)/);
  for (const marker of [
    "/api/pets/catalog?mine=1",
    "/api/pets/evolve",
    "/api/pets/release",
    "/api/points/redeem-pet",
    "SubSelectionModal",
    "FusionOverlay",
    "RedeemShopModal",
    "storageLabel",
    "rarityFilter",
  ]) {
    assert.ok(p.includes(marker), `collection-panel 缺失能力标记: ${marker}`);
  }
  assert.ok(!p.includes('t("crossBanner")'), "互跳条 crossBanner 引用必须移除");
  assert.ok(!p.includes("<main"), "面板不得再含页面级 <main> 壳");
  assert.ok(!p.includes("/login?redirect="), "未登录跳转已上移至 Tab 壳");
});

test("merge(4): /my-pets 308 → /pets/my，全站业务代码无 /my-pets 残留引用", () => {
  const redirect = read("../src/app/[locale]/my-pets/page.tsx");
  assert.match(redirect, /permanentRedirect\(`\/\$\{locale\}\/pets\/my`\)/);
  // src 全仓扫描：/my-pets 只允许出现在 308 重定向页的注释中
  const srcRoot = join(here, "../src");
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  })(srcRoot);
  const offenders = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    if (/href="\/my-pets"|redirect=\/my-pets|push\("\/my-pets|path: "\/my-pets"/.test(text)) {
      offenders.push(f);
    }
  }
  assert.deepEqual(offenders, [], `发现 /my-pets 残留引用：${offenders.join(", ")}`);
});

test("merge(5): i18n Tab 键双语新增 + 互跳条键清除", () => {
  for (const loc of ["zh", "en"]) {
    const msg = JSON.parse(read(`../messages/${loc}.json`));
    assert.ok(msg.myPets.tabCompanion, `${loc} myPets.tabCompanion 缺失`);
    assert.ok(msg.myPets.tabCollection, `${loc} myPets.tabCollection 缺失`);
    assert.equal(msg.myPets.evolveBanner, undefined, `${loc} myPets.evolveBanner 必须删除`);
    assert.equal(msg.myPets.evolveGo, undefined, `${loc} myPets.evolveGo 必须删除`);
    assert.equal(msg.petsCatalog.crossBanner, undefined, `${loc} petsCatalog.crossBanner 必须删除`);
    assert.equal(msg.petsCatalog.crossGo, undefined, `${loc} petsCatalog.crossGo 必须删除`);
  }
});

test("merge(6): 入口引用统一指向 /pets/my", () => {
  assert.match(read("../src/components/layout/SiteHeader.tsx"), /href: "\/pets\/my"/);
  assert.match(read("../src/app/sitemap.ts"), /path: "\/pets\/my"/);
  assert.match(read("../src/app/[locale]/points/page.tsx"), /href="\/pets\/my"/);
  assert.match(read("../src/app/[locale]/handbooks/page.tsx"), /href="\/pets\/my"/);
  assert.match(read("../src/app/[locale]/marketplace/page.tsx"), /href="\/pets\/my"/);
  assert.match(read("../src/app/[locale]/page.tsx"), /redirect=\/pets\/my/);
});
