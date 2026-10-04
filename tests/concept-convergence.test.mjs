// P0 概念收敛 Commit 2（2026-10-14）契约测试：
//  1) 停铸开关单一事实源（aibi-flags.ts）：mintAibi 全入口 410 DISCONTINUED
//     （开包/融合/管理员/实物认领共用），pack/buy 独立 410 短路；
//  2) 收藏中心双 Tab：TABS=[soul,nfr]，?tab=aibi 旧链接白名单兜底落 soul，
//     AibiSoulPanel 组件删除；
//  3) 历史凭证：/api/soul-cards/[id] 仅卡主本人（Bearer + ownerId 匹配）附带
//     legacyTokens；详情弹窗 <details> 折叠只读；客户端 openDetail 带 Bearer；
//  4) 导航收敛：一级 = /pets /soul-cards /blindbox /explore-v2；
//     /packs /bag 降入「更多」，避免一级同时出现三套资产；
//  5) 前端停售/停用 UI：packs-client 公告+守卫+按钮禁用、bag-client 融合禁用、
//     fusion-modal 提交守卫；
//  6) i18n：collection.tabs 无 aibi 且 zh/en 对齐、discontinued/legacy* 双语。
// 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/concept-convergence.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  AIBI_MINT_DISCONTINUED,
  AIBI_PACK_SALES_DISCONTINUED,
} from "../src/lib/aibi-flags.ts";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const exists = (rel) => existsSync(join(ROOT, rel));

// === 1) 停铸开关与全入口守卫 ===
test("flags: discontinuation switches on; mintAibi guards all mint paths", () => {
  assert.equal(AIBI_MINT_DISCONTINUED, true);
  assert.equal(AIBI_PACK_SALES_DISCONTINUED, true);
  const service = read("src/lib/aibi-service.ts");
  assert.ok(service.includes('from "./aibi-flags"'), "service imports flags");
  assert.ok(
    service.includes('if (AIBI_MINT_DISCONTINUED) throw new AibiError("DISCONTINUED", 410)'),
    "mintAibi entry guard 410",
  );
  // 守卫在发号/写库之前（函数体最前）
  const guardIdx = service.indexOf('AibiError("DISCONTINUED", 410)');
  const seqIdx = service.indexOf("nextval('aibi_token_seq')");
  assert.ok(guardIdx > -1 && seqIdx > guardIdx, "guard precedes any DB write");
  // 错误文案双语
  const api = read("src/lib/aibi-api.ts");
  assert.ok(api.includes("DISCONTINUED"), "aibi-api MESSAGES covers DISCONTINUED");
});

test("pack/buy: 410 short-circuit before any write (history preserved for rollback)", () => {
  const route = read("src/app/api/pack/buy/route.ts");
  assert.ok(
    route.includes('if (AIBI_PACK_SALES_DISCONTINUED) return aibiFail("DISCONTINUED", 410, req)'),
    "410 short-circuit",
  );
  const guardIdx = route.indexOf("AIBI_PACK_SALES_DISCONTINUED) return");
  const writeIdx = route.indexOf("UPDATE users SET points");
  assert.ok(guardIdx > -1 && writeIdx > guardIdx, "guard precedes points deduction");
});

// === 2) 收藏中心双 Tab ===
test("collection: two tabs; aibi tab removed with legacy-link fallback", () => {
  const cc = read("src/components/collection/collection-client.tsx");
  assert.ok(cc.includes('["soul", "nfr"]'), "TABS = soul|nfr");

// === 3) 历史凭证（legacyTokens，仅卡主本人） ===
test("legacy tokens: detail API attaches for owner only; modal renders read-only", () => {
  const route = read("src/app/api/soul-cards/[id]/route.ts");
  assert.ok(route.includes("getUserFromRequest(req)"), "optional auth");
  assert.ok(route.includes("detail.card.ownerId === user.id"), "owner-only gate");
  assert.ok(route.includes("listLegacyAibiTokens(user.id)"), "queries legacy tokens");
  const service = read("src/server/services/soul-card-service.ts");
  assert.ok(service.includes("export async function listLegacyAibiTokens"), "service export");
  assert.ok(service.includes("aibiTokens") && service.includes(".limit(50)"), "aibi_tokens source");
  const client = read("src/components/soul-card/soul-cards-client.tsx");
  assert.ok(client.includes("Authorization: `Bearer ${token}`"), "openDetail sends Bearer");
  assert.ok(client.includes("legacyTokens"), "detail state carries legacyTokens");
  const modal = read("src/components/soul-card/soul-card-detail-modal.tsx");
  assert.ok(modal.includes("<details"), "collapsed <details> section");
  assert.ok(modal.includes('t("detail.legacyTokens"'), "legacy section i18n");
  assert.ok(modal.includes('t("burn.button")'), "burn section untouched");
});

// === 4) 导航收敛 ===
test("nav: primary = pets/soul-cards/blindbox/explore; packs & bag demoted", () => {
  const header = read("src/components/layout/SiteHeader.tsx");
  const mainBlock = header.slice(header.indexOf("const mainItems"), header.indexOf("];", header.indexOf("const mainItems")));
  assert.ok(mainBlock.includes('href: "/pets"'), "main: /pets");
  assert.ok(mainBlock.includes('href: "/soul-cards"'), "main: /soul-cards");
  assert.ok(mainBlock.includes('href: "/blindbox"'), "main: /blindbox");
  assert.ok(mainBlock.includes('href: "/explore-v2"'), "main: /explore-v2");
  assert.ok(!mainBlock.includes('href: "/packs"'), "packs not in primary nav");
  assert.ok(!mainBlock.includes('href: "/bag"'), "bag not in primary nav");
  const moreBlock = header.slice(header.indexOf("const moreItems"), header.indexOf("];", header.indexOf("const moreItems")));
  assert.ok(moreBlock.includes('href: "/packs"'), "packs demoted to More");
  assert.ok(moreBlock.includes('href: "/bag"'), "bag demoted to More");
  assert.ok(!moreBlock.includes('href: "/explore-v2"'), "explore-v2 not duplicated");
});

// === 5) 前端停售/停用 UI ===
test("frontend guards: packs banner+disabled buy; bag fusion disabled; fusion modal guard", () => {
  const packs = read("src/components/aibi/packs-client.tsx");
  assert.ok(packs.includes("AIBI_PACK_SALES_DISCONTINUED"), "packs imports flag");
  assert.ok(packs.includes('t("discontinued")'), "discontinued banner");
  assert.ok(packs.includes("disabled={buying !== null || AIBI_PACK_SALES_DISCONTINUED}"),
    "buy button disabled");
  const bag = read("src/components/aibi/bag-client.tsx");
  assert.ok(bag.includes("disabled={AIBI_MINT_DISCONTINUED}"), "fusion button disabled");
  assert.ok(bag.includes('t("fuseDiscontinued")'), "fusion disabled hint");
  const fusion = read("src/components/aibi/fusion-modal.tsx");
  assert.ok(fusion.includes("AIBI_MINT_DISCONTINUED"), "fusion modal guard");
});

// === 6) i18n 双语 ===
test("i18n: collection tabs without aibi; discontinued/legacy keys bilingual & aligned", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  assert.ok(!zh.collection.tabs.aibi && !en.collection.tabs.aibi, "no aibi tab label");
  assert.ok(zh.collection.tabs.soul.includes("我的灵宠"), "zh soul tab = 我的灵宠");
  assert.ok(zh.collection.tabs.nfr.includes("世界藏品"), "zh nfr tab = 世界藏品");
  for (const dict of [zh, en]) {
    assert.equal(typeof dict.aibi.packs.discontinued, "string", "packs.discontinued");
    assert.equal(typeof dict.aibi.bag.fuseDiscontinued, "string", "bag.fuseDiscontinued");
    assert.equal(typeof dict.aibi.fuse.discontinued, "string", "fuse.discontinued");
    assert.equal(typeof dict.soulCards.detail.legacyTokens, "string", "detail.legacyTokens");
    assert.equal(typeof dict.soulCards.detail.legacyEmpty, "string", "detail.legacyEmpty");
    assert.equal(typeof dict.soulCards.detail.legacyHint, "string", "detail.legacyHint");
  }
  const flatten = (obj, prefix = "") =>
    Object.entries(obj ?? {}).flatMap(([k, v]) =>
      v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );
  assert.deepEqual(flatten(zh.collection).sort(), flatten(en.collection).sort(),
    "collection zh/en deep keys aligned");
  assert.deepEqual(flatten(zh.aibi).sort(), flatten(en.aibi).sort(),
    "aibi zh/en deep keys aligned");
});

// === 7) Commit 3 · 用户-facing 文案去链上表述（防回归） ===
test("de-chained: no blockchain jargon in any user-facing message value", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  const ZH_BANNED = /链上|区块链|合约|NFT|铸造|模拟链|钱包地址|交易哈希/;
  // 词边界防误伤（Fusion chain 融合链 / 模板占位符 {minted} 不算链上表述）
  const EN_BANNED = /blockchain|\bon[- ]chain\b|\boff-chain\b|Simulated Chain|\bNFT\b|\bmint(ing|ed)?\b/i;
  const stripPlaceholders = (s) => s.replace(/\{[^}]*\}/g, "");
  const scan = (obj, path, re, out) => {
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (typeof v === "string") {
        if (re.test(stripPlaceholders(v))) out.push(`${p} = ${v.slice(0, 60)}`);
      } else if (v && typeof v === "object") scan(v, p, re, out);
    }
    return out;
  };
  assert.deepEqual(scan(zh, "", ZH_BANNED, []), [], "zh messages 无链上表述");
  assert.deepEqual(scan(en, "", EN_BANNED, []), [], "en messages 无 blockchain jargon");
  // AI 聊天语料同属用户-facing：aibi-prompt 不得自称链上
  const prompt = read("src/lib/aibi-prompt.ts");
  assert.ok(!prompt.includes("链上艾比"), "aibi prompt zh welcome de-chained");
  assert.ok(!/on-chain/i.test(prompt), "aibi prompt en copy de-chained");
});

  assert.ok(!cc.includes('"aibi"'), "no aibi tab id");
  assert.ok(cc.includes('?? "soul"'), "default tab = soul");
  assert.ok(!cc.includes("AibiSoulPanel"), "panel unmounted");
  assert.ok(!exists("src/components/aibi/aibi-soul-panel.tsx"), "panel file deleted");
});
