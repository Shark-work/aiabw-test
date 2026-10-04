/**
 * P1 故事外显 · 繁育叙事升级「羁绊结晶」契约测试（2026-10-14，改动三）
 *
 * 覆盖（验收口径：羁绊达标可结晶 + 双奖励 + 自动灵魂凭证 + 全站无生物学术语）：
 *  1) bond-config 纯函数：权重/封顶/双向较小值/阈值边界；
 *  2) GET /api/pets/[id]/bonds：401/404 + 关联链（adoptions→user_collectibles→pets）
 *     + 同物种过滤 + breedCost 下发；
 *  3) /api/pets/breed：结晶灵宠自动铸卡（COMMIT 后 + SOUL_CARD_EXISTS 容错）+ 响应 soulCard
 *     + 初始消息叙事（灵魂共鸣）；
 *  4) BondPanel：数据源 / 结晶调用 parentIds / 双奖励弹窗 / companion-panel 挂载；
 *  5) 文案清零：messages zh/en 值递归扫描无「繁育/繁殖/后代/生育/breed/offspring」，
 *     social-poster / breed 路由用户可见串同口径；
 *  6) i18n myPets.bond 命名空间 zh/en 对齐。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  BOND_UNLOCK_THRESHOLD,
  bondScore,
  bondUnlocked,
} from "../src/lib/bond-config.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const zh = JSON.parse(read("messages/zh.json"));
const en = JSON.parse(read("messages/en.json"));

// === 1) bond-config 纯函数 ===
test("bondScore: weights/caps/bilateral-min/threshold", () => {
  // 全零 → 0，未达标
  assert.equal(
    bondScore({ sharedExplorations: 0, myHappiness: 0, partnerHappiness: 0, myChats: 0, partnerChats: 0 }),
    0,
  );
  // 探索封顶 40：100 次探索仍 40
  const exploreCap = bondScore({ sharedExplorations: 100, myHappiness: 0, partnerHappiness: 0, myChats: 0, partnerChats: 0 });
  assert.equal(exploreCap, 40);
  // 双向较小值：幸福 min(80, 30)=30 ×0.3 = 9；聊天 min(10, 2)=2 ×1.5 = 3
  const bilateral = bondScore({ sharedExplorations: 0, myHappiness: 80, partnerHappiness: 30, myChats: 10, partnerChats: 2 });
  assert.equal(bilateral, Math.round(9 + 3));
  // 典型养成路径达标：探索 10（40）+ 幸福双 50（15）+ 聊天双 4（6）= 61 ≥ 60
  const path = bondScore({ sharedExplorations: 10, myHappiness: 50, partnerHappiness: 50, myChats: 4, partnerChats: 4 });
  assert.equal(path, 61);
  assert.ok(bondUnlocked(path));
  assert.ok(!bondUnlocked(BOND_UNLOCK_THRESHOLD - 1));
  assert.ok(bondUnlocked(BOND_UNLOCK_THRESHOLD));
  // 上限 100
  const cap = bondScore({ sharedExplorations: 999, myHappiness: 100, partnerHappiness: 100, myChats: 999, partnerChats: 999 });
  assert.equal(cap, 100);
});

// === 2) GET /api/pets/[id]/bonds ===
test("bonds api: auth/404 + adoption→uc→pets chain + same-species filter + breedCost", () => {
  const c = read("src/app/api/pets/[id]/bonds/route.ts");
  assert.ok(c.includes("getUserFromRequest(req)"), "bearer auth");
  assert.ok(c.includes("{ status: 401 }"), "unauthenticated 401");
  assert.ok(
    c.includes("JOIN user_collectibles uc ON uc.adoption_id = a.id"),
    "me via adoption→user_collectibles",
  );
  assert.ok(c.includes("JOIN pets p ON p.id = uc.source_pet_id"), "uc→pets");
  assert.ok(c.includes("WHERE a.id = $1 AND a.user_id = $2"), "ownership in query");
  assert.ok(c.includes("{ status: 404 }"), "no collectible link → 404");
  assert.ok(c.includes("p.species_id = $2"), "same-species partners");
  assert.ok(c.includes("uc.id != $3"), "exclude self");
  assert.ok(c.includes("uc.status = 'active'"), "active collectibles only");
  assert.ok(c.includes("FROM exploration_records WHERE user_id = $1"), "shared explorations source");
  assert.ok(c.includes("bondScore({"), "pure fn applied per partner");
  assert.ok(c.includes("breedCost: BREED_COST"), "cost from single source genetics");
});

// === 3) breed：结晶灵宠自动铸卡 + 叙事 ===
test("breed route: auto-mint soul card after COMMIT + soul resonance narrative", () => {
  const c = read("src/app/api/pets/breed/route.ts");
  const commitIdx = c.indexOf('await client.query("COMMIT")');
  const mintIdx = c.indexOf("await mintSoulCard({ userId: user.id, petId })");
  assert.ok(commitIdx > 0 && mintIdx > commitIdx, "mint runs after COMMIT (non-blocking)");
  assert.ok(c.includes('err.code === "SOUL_CARD_EXISTS"'), "SOUL_CARD_EXISTS tolerated");
  assert.ok(c.includes("findSoulCardByPetId(petId)"), "existing card refetched");
  assert.ok(c.includes("soulCard,"), "response carries soulCard");
  // 初始消息叙事：灵魂共鸣诞生的结晶灵宠（无生物学术语）
  assert.ok(c.includes("在灵魂共鸣中诞生的结晶灵宠"), "zh birth message");
  assert.ok(c.includes("born from soul resonance"), "en birth message");
  assert.ok(!c.includes("是繁育诞生的新伙伴"), "old zh message gone");
  assert.ok(!c.includes("born from breeding"), "old en message gone");
});

// === 4) BondPanel + companion-panel 挂载 ===
test("bond panel: data source / crystallize call / dual-reward modal / mounted", () => {
  const b = read("src/components/pets/bond-panel.tsx");
  assert.ok(b.includes("fetch(`/api/pets/${adoptionId}/bonds`"), "bonds data source");
  assert.ok(b.includes('fetch("/api/pets/breed"'), "crystallize via /api/pets/breed");
  assert.ok(
    b.includes("parentIds: [data.me.collectibleId, confirm.collectibleId]"),
    "parentIds = me + partner collectibles",
  );
  assert.ok(b.includes("BOND_UNLOCK_THRESHOLD"), "threshold from shared config");
  assert.ok(b.includes("d.soulCard?.certificateNo"), "certificate shown in result");
  assert.ok(b.includes("d.nfr?.hashId"), "crystal collectible hashId shown");
  // 挂载
  const p = read("src/components/pets/companion-panel.tsx");
  assert.ok(p.includes('import { BondPanel } from "./bond-panel"'), "import");
  assert.ok(p.includes("<BondPanel adoptionId={selectedPet.id} />"), "mounted in pet detail");
});

// === 5) 文案清零：messages zh/en 值递归扫描 + 用户可见源码串 ===
test("narrative: no biology terms in messages values (zh/en) nor user-facing strings", () => {
  const ZH_BANNED = /繁育|繁殖|后代|生育/;
  const EN_BANNED = /\b breeds? \b|\b breeding \b|\b offspring \b/i;
  const scan = (obj, path, re, out) => {
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (typeof v === "string") {
        // en：key 名豁免（breed 命名空间/错误码 key 为代码标识符），只扫值
        if (re.test(v)) out.push(`${p} = ${v}`);
      } else if (v && typeof v === "object") scan(v, p, re, out);
    }
    return out;
  };
  assert.deepEqual(scan(zh, "", ZH_BANNED, []), [], "zh messages 无「繁育/繁殖/后代/生育」");
  assert.deepEqual(scan(en, "", EN_BANNED, []), [], "en messages no breed/offspring wording");
  // 中文用户可见源码串（社交分享模板 / breed 路由初始消息）
  for (const f of ["src/lib/social-poster.ts", "src/app/api/pets/breed/route.ts"]) {
    const c = read(f);
    for (const banned of ["繁育", "繁殖", "后代", "生育"]) {
      assert.ok(!c.includes(banned), `${f} must not contain 「${banned}」 (user-facing)`);
    }
  }
  // 叙事正向词：羁绊 / 共鸣 / 结晶灵宠
  assert.ok(JSON.stringify(zh.myPets.bond).includes("羁绊"), "zh bond narrative");
  assert.ok(JSON.stringify(zh).includes("结晶灵宠"), "zh crystal soul pet");
  // README 叙事同步
  const readme = read("README.md");
  for (const banned of ["繁育", "繁殖"]) {
    assert.ok(!readme.includes(banned), `README must not contain 「${banned}」`);
  }
});

// === 6) i18n myPets.bond 命名空间 zh/en 对齐 ===
test("bond i18n: myPets.bond namespace aligned zh/en", () => {
  for (const dict of [zh, en]) {
    const b = dict.myPets?.bond;
    assert.ok(b, "myPets.bond namespace");
    for (const k of [
      "title",
      "loading",
      "empty",
      "scoreLabel",
      "unlocked",
      "thresholdHint",
      "lockedHint",
      "cooldown",
      "crystalCta",
      "confirmTitle",
      "confirmDesc",
      "confirmOk",
      "confirmCancel",
      "working",
      "successTitle",
      "newPet",
      "newNfr",
      "certNo",
      "failed",
    ]) {
      assert.ok(b[k], `myPets.bond.${k}`);
    }
    assert.ok(b.thresholdHint.includes("{threshold}"), "thresholdHint param");
    assert.ok(
      b.confirmDesc.includes("{cost}") && b.confirmDesc.includes("{partner}"),
      "confirmDesc params",
    );
  }
  // 既有 breed 面板文案同步叙事（collection.nfr.breed 命名空间）
  assert.equal(zh.collection.nfr.breed.title, "结晶共鸣", "zh breed panel title");
  assert.equal(zh.collection.nfr.actions.breed, "结晶", "zh action tab");
  assert.equal(zh.leaderboard.tabBreeders, "结晶达人", "zh leaderboard tab");
  assert.equal(en.collection.nfr.breed.title, "Resonance Pair", "en breed panel title");
  assert.equal(en.leaderboard.tabBreeders, "Top Crystallizers", "en leaderboard tab");
  // api 错误文案叙事
  assert.ok(zh.api.breedCooldown.includes("羁绊"), "zh cooldown narrative");
  assert.ok(en.api.breedFailed.includes("Crystallization"), "en failure narrative");
});

