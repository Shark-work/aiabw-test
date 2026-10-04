// 唤醒即铸卡（P0 概念收敛 Commit 1，2026-10-14）契约测试：
//  1) /api/pets/claim：COMMIT 后自动 mintSoulCard（登录用户），SOUL_CARD_EXISTS 幂等回查，
//     其他失败容错不阻断领养，响应携带 soulCard 简报；evm 出块等待 → maxDuration=60；
//  2) /api/auth/migrate：游客宠物归并 RETURNING id → 逐只 best-effort 补铸；
//  3) /api/pets/[id]/interact：每日首次互动 +SOUL_CARD_INTERACT_EXP 经验
//     （soul_cards.updated_at UTC 日期判定，mint 当天不重复，天然防刷）；
//  4) 手动 mint 入口全部移除（路由/组件/服务端函数/前端区块/i18n 命名空间）；
//  5) 领养弹窗（PetKnowledgeModal）展示灵魂卡编号；/pets 页接线传参；
//  6) i18n：petsCatalog.soulCardMinted 双语 + soulCards.collection.goAdopt 双语。
// 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/claim-soul-card.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  SOUL_CARD_INTERACT_EXP,
  applyGrowthExp,
} from "../src/lib/soul-card-config.ts";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const exists = (rel) => existsSync(join(ROOT, rel));

// === 1) 领养自动铸卡（/api/pets/claim） ===
test("claim: auto-mint soul card after COMMIT with idempotent fallback", () => {
  const src = read("src/app/api/pets/claim/route.ts");
  assert.ok(src.includes('import { mintSoulCard, SoulCardError } from "@/server/services/soul-card-service"'),
    "imports mintSoulCard");
  assert.ok(src.includes('from "@/server/repositories/soul-card-repository"'),
    "imports findSoulCardByPetId for idempotent refetch");
  assert.ok(src.includes("maxDuration = 60"), "evm block-wait headroom");
  // 铸卡发生在事务 COMMIT 之后（失败不回滚已完成的领养）
  const commitIdx = src.indexOf('await client.query("COMMIT")');
  const mintIdx = src.indexOf("await mintSoulCard({ userId: user.id, petId: pet.id })");
  assert.ok(commitIdx > 0 && mintIdx > commitIdx, "mint runs after COMMIT");
  assert.ok(src.includes('err.code === "SOUL_CARD_EXISTS"'), "idempotent: existing card refetched");
  assert.ok(src.includes('console.error("[pets/claim] soul card mint failed:"'),
    "non-idempotent mint failure tolerated & logged");
  assert.ok(src.includes("soulCard,"), "response carries soulCard brief");
});

// === 2) 游客归并补铸（/api/auth/migrate） ===
test("migrate: merged guest pets get soul cards minted (best-effort)", () => {
  const src = read("src/app/api/auth/migrate/route.ts");
  assert.ok(src.includes("RETURNING id"), "pets merge returns ids");
  assert.ok(src.includes("await mintSoulCard({ userId: user.id, petId: row.id })"),
    "mints per merged pet");
  assert.ok(src.includes('err.code === "SOUL_CARD_EXISTS"'), "SOUL_CARD_EXISTS tolerated");
  assert.ok(src.includes("soulCards: soulCardsMinted"), "response reports minted count");
  assert.ok(src.includes("maxDuration = 60"), "evm block-wait headroom");
});

// === 3) 互动成长挂点（/api/pets/[id]/interact） ===
test("interact: daily-first interaction awards soul card EXP", () => {
  const src = read("src/app/api/pets/[id]/interact/route.ts");
  assert.ok(src.includes("SOUL_CARD_INTERACT_EXP"), "uses shared EXP constant");
  assert.ok(src.includes("applyGrowthExp("), "settles EXP via pure function");
  assert.ok(src.includes("updateSoulCardGrowth(card.id"), "persists growth");
  assert.ok(src.includes("findSoulCardByPetId(id)"), "looks up card by pet");
  assert.ok(src.includes('card.status === "active"'), "burned cards earn nothing");
  assert.ok(src.includes("toISOString().slice(0, 10)"), "UTC-date daily gate");
  assert.ok(src.includes("growth,"), "response carries growth payload");
  assert.ok(
    src.includes('console.error("[pets/interact] soul card growth failed:"'),
    "growth failure does not break interaction",
  );
});


test("config: SOUL_CARD_INTERACT_EXP constant & EXP math stays intact", () => {
  assert.equal(SOUL_CARD_INTERACT_EXP, 25);
  // 每日 +25：Lv.1（满 100 升级）→ 4 天升 Lv.2；经验数学未被本次改动影响
  assert.deepEqual(applyGrowthExp(1, 75, SOUL_CARD_INTERACT_EXP), {
    level: 2, exp: 0, stage: "seed", leveledUp: true,
  });
});

// === 4) 手动 mint 入口全部移除 ===
test("manual mint entrypoints removed across the stack", () => {
  assert.ok(!exists("src/app/api/soul-cards/mint/route.ts"), "mint API route removed");
  assert.ok(!exists("src/components/soul-card/mint-soul-card-button.tsx"),
    "mint button component removed");
  const service = read("src/server/services/soul-card-service.ts");
  assert.ok(!service.includes("listMintablePets"), "service no longer lists mintable pets");
  const repo = read("src/server/repositories/soul-card-repository.ts");
  assert.ok(!repo.includes("listMintablePetsByOwner"), "repo mintable query removed");
  assert.ok(!repo.includes("MintablePet"), "MintablePet type removed");
  const api = read("src/app/api/soul-cards/route.ts");
  assert.ok(!api.includes("listMintablePets"),
    "GET /api/soul-cards no longer serves mintablePets");
  const client = read("src/components/soul-card/soul-cards-client.tsx");
  assert.ok(!client.includes("MintSoulCardButton"), "client has no mint button");
  assert.ok(!client.includes("mintable"), "client has no mintable section");
  const types = read("src/components/soul-card/soul-card-types.ts");
  assert.ok(!types.includes("MintablePetDto"), "MintablePetDto removed");
});

// === 5) 领养弹窗展示卡号 + /pets 页接线 ===
test("adoption modal shows certificate number; /pets page wires soulCard", () => {
  const modal = read("src/components/pet-knowledge-modal.tsx");
  assert.ok(modal.includes("soulCard?: { certificateNo: string; name: string } | null"),
    "KnowledgePet carries soulCard");
  assert.ok(modal.includes('t("soulCardMinted")'), "renders minted label");
  assert.ok(modal.includes("pet.soulCard.certificateNo"), "renders certificate number");
  const page = read("src/app/[locale]/pets/page.tsx");
  assert.ok(page.includes("data.soulCard"), "claim response soulCard forwarded");
  assert.ok(page.includes("certificateNo: data.soulCard.certificateNo"),
    "certificateNo mapped into KnowledgePet");
});

// === 6) i18n 双语 ===
test("i18n: soulCardMinted + goAdopt bilingual; zh/en soulCards deep keys aligned", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  assert.equal(typeof zh.petsCatalog.soulCardMinted, "string");
  assert.equal(typeof en.petsCatalog.soulCardMinted, "string");
  assert.equal(typeof zh.soulCards.collection.goAdopt, "string");
  assert.equal(typeof en.soulCards.collection.goAdopt, "string");
  const flatten = (obj, prefix = "") =>
    Object.entries(obj ?? {}).flatMap(([k, v]) =>
      v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );
  assert.deepEqual(
    flatten(zh.soulCards).sort(),
    flatten(en.soulCards).sort(),
    "soulCards namespace zh/en key sets identical",
  );
});
