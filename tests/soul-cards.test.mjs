// Aibi Soul Card · 契约测试（平台升级 Phase 1，2026-09-30）
// 覆盖：共享配置（稀有度/元素/成长阶段/凭证编号/经验结算）+ 链层
//      （MockChainProvider 哈希格式 / 地址派生 / 工厂回退）+ drizzle/0024 迁移
//      + schema 导出 + client.ts 注入（SCHEMA_VERSION=6）+ service 契约
//      + API 路由 + 错误映射 + i18n 双语 + 前端组件接线 + Solidity 合约结构
// 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/soul-cards.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  SOUL_CARD_RARITIES,
  RARITY_ORDER,
  RARITY_META,
  SOUL_CARD_ELEMENTS,
  ELEMENT_META,
  GROWTH_STAGES,
  GROWTH_LEVEL_MAX,
  stageForLevel,
  expToNextLevel,
  applyGrowthExp,
  certificateNoForTokenId,
  normalizeRarity,
  normalizeElement,
  CHAIN_SUPPLY_SINGLETON_ID,
  DEFAULT_MAX_SUPPLY,
} from "../src/lib/soul-card-config.ts";
import { createMockChainProvider } from "../src/server/chain/mock-chain-provider.ts";
import {
  CHAIN_CONTRACT_ADDRESS,
  CHAIN_MAX_SUPPLY,
  CHAIN_PLATFORM_ADDRESS,
  chainAddressForUser,
} from "../src/server/chain/chain-config.ts";
import { getChainProvider } from "../src/server/chain/get-chain-provider.ts";
import { createEvmChainProvider } from "../src/server/chain/evm-chain-provider.ts";
import { AIBI_SOUL_CARD_ABI } from "../src/server/chain/aibi-soul-card-abi.ts";
import { chainLedger, chainSupply, soulCards } from "../src/db/schema.ts";
import { encodeAbiParameters, encodeEventTopics } from "viem";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const exists = (rel) => existsSync(join(ROOT, rel));

// === 1) 稀有度/元素与既有系统对齐（5 级 × 4 系，meta 双语齐全） ===
test("config: 5 rarities in order + 4 elements, meta bilingual & complete", () => {
  assert.deepEqual([...SOUL_CARD_RARITIES], [
    "common",
    "uncommon",
    "rare",
    "epic",
    "legendary",
  ]);
  SOUL_CARD_RARITIES.forEach((r, i) => {
    assert.equal(RARITY_ORDER[r], i, `${r} order weight`);
    const meta = RARITY_META[r];
    assert.ok(meta.emoji && meta.labelZh && meta.labelEn, `${r} meta labels`);
    assert.ok(meta.badgeClass && meta.frameClass, `${r} style classes`);
  });
  assert.deepEqual([...SOUL_CARD_ELEMENTS], ["fire", "water", "earth", "air"]);
  for (const e of SOUL_CARD_ELEMENTS) {
    const meta = ELEMENT_META[e];
    assert.ok(meta.emoji && meta.labelZh && meta.labelEn, `${e} meta labels`);
  }
});

// === 2) 成长阶段阈值（seed→sprout→bloom→radiant） ===
test("config: stageForLevel thresholds 1/10/30/60", () => {
  assert.deepEqual(
    GROWTH_STAGES.map((s) => [s.id, s.minLevel]),
    [["seed", 1], ["sprout", 10], ["bloom", 30], ["radiant", 60]],
  );
  const cases = [
    [1, "seed"], [9, "seed"], [10, "sprout"], [29, "sprout"],
    [30, "bloom"], [59, "bloom"], [60, "radiant"], [99, "radiant"],
  ];
  for (const [level, expected] of cases) {
    assert.equal(stageForLevel(level).id, expected, `level ${level} → ${expected}`);
  }
  assert.equal(GROWTH_LEVEL_MAX, 99, "level cap 99");
});

// === 3) 经验结算纯函数：线性需求 / 连升 / 封顶 ===
test("config: expToNextLevel linear ×100, cap 0", () => {
  assert.equal(expToNextLevel(1), 100);
  assert.equal(expToNextLevel(2), 200);
  assert.equal(expToNextLevel(50), 5000);
  assert.equal(expToNextLevel(GROWTH_LEVEL_MAX), 0);
});

test("config: applyGrowthExp no-level / single / multi-level / cap", () => {
  assert.deepEqual(applyGrowthExp(1, 0, 50), {
    level: 1, exp: 50, stage: "seed", leveledUp: false,
  });
  assert.deepEqual(applyGrowthExp(1, 0, 100), {
    level: 2, exp: 0, stage: "seed", leveledUp: true,
  });
  // 连升：Lv1→2 需 100、Lv2→3 需 200，共 300；+350 后 Lv.3 余 50
  assert.deepEqual(applyGrowthExp(1, 0, 350), {
    level: 3, exp: 50, stage: "seed", leveledUp: true,
  });
  // 阶段跨越：Lv.9→10 需 9×100=900 → +900 后 Lv.10 sprout
  assert.deepEqual(applyGrowthExp(9, 0, 900), {
    level: 10, exp: 0, stage: "sprout", leveledUp: true,
  });
  // 封顶：满级不再吸收经验
  assert.deepEqual(applyGrowthExp(99, 0, 99999), {
    level: 99, exp: 0, stage: "radiant", leveledUp: false,
  });
  // 临近满级：98 + 大额经验 → 99 清零
  const near = applyGrowthExp(98, 0, 100000);
  assert.equal(near.level, 99);
  assert.equal(near.exp, 0);
  assert.equal(near.leveledUp, true);
});

// === 4) 凭证编号：AIBI-000001 六位补齐、随 tokenId 唯一 ===
test("config: certificateNoForTokenId format & uniqueness", () => {
  assert.equal(certificateNoForTokenId(1), "AIBI-000001");
  assert.equal(certificateNoForTokenId(42), "AIBI-000042");
  assert.equal(certificateNoForTokenId(1234), "AIBI-001234");
  assert.match(certificateNoForTokenId(100000), /^AIBI-\d{6}$/);
  const seen = new Set([1, 2, 3, 999, 10000].map(certificateNoForTokenId));
  assert.equal(seen.size, 5, "distinct tokenIds → distinct certificate numbers");
});

// === 5) 规范化回退（兼容脏 traits 数据） ===
test("config: normalizeRarity/normalizeElement fallbacks", () => {
  assert.equal(normalizeRarity("rare"), "rare");
  assert.equal(normalizeRarity("legendary"), "legendary");
  assert.equal(normalizeRarity("RARE"), "common", "case-sensitive → fallback");
  assert.equal(normalizeRarity(undefined), "common");
  assert.equal(normalizeRarity(123), "common");
  assert.equal(normalizeElement("fire"), "fire");
  assert.equal(normalizeElement("wind"), "earth", "unknown → earth");
  assert.equal(normalizeElement(undefined), "earth");
  assert.equal(CHAIN_SUPPLY_SINGLETON_ID, 1);
  assert.equal(DEFAULT_MAX_SUPPLY, 100000);
});

// === 6) MockChainProvider：EVM 格式回执（0x+64hex 哈希 / confirmed / 透传区块号） ===
test("chain: mock provider receipts match EVM formats", async () => {
  const provider = createMockChainProvider();
  assert.equal(provider.id, "mock");
  assert.equal(provider.isSimulated, true);
  assert.equal(typeof provider.network, "string");
  assert.match(provider.contractAddress, /^0x.{40}$/, "contract address 0x+40");

  const metadata = {
    name: "测试卡",
    description: "d",
    image: "https://example.com/x.png",
    attributes: [{ trait_type: "rarity", value: "rare" }],
  };
  const mint = await provider.mint({
    toAddress: chainAddressForUser("user-1"),
    tokenId: 7,
    blockNumber: 100,
    metadata,
  });
  assert.match(mint.txHash, /^0x[0-9a-f]{64}$/, "txHash 0x+64hex");
  assert.equal(mint.txType, "mint");
  assert.equal(mint.tokenId, 7);
  assert.equal(mint.blockNumber, 100);
  assert.equal(mint.status, "confirmed");

  const burn = await provider.burn({ tokenId: 7, blockNumber: 101 });
  assert.match(burn.txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(burn.txType, "burn");
  assert.equal(burn.blockNumber, 101);

  const transfer = await provider.transfer({
    fromAddress: chainAddressForUser("user-1"),
    toAddress: chainAddressForUser("user-2"),
    tokenId: 7,
    blockNumber: 102,
  });
  assert.equal(transfer.txType, "transfer");
  assert.match(transfer.txHash, /^0x[0-9a-f]{64}$/);

  // nonce：相同入参两次 mint 哈希不同（并发/重试不撞车）
  const again = await provider.mint({
    toAddress: chainAddressForUser("user-1"),
    tokenId: 7,
    blockNumber: 100,
    metadata,
  });
  assert.notEqual(mint.txHash, again.txHash, "nonce makes hashes unique");
});

// === 7) 链上地址派生与平台金库 ===
test("chain: chainAddressForUser deterministic 0x+40hex; platform = zero address", () => {
  const a1 = chainAddressForUser("00000000-0000-0000-0000-000000000001");
  assert.match(a1, /^0x[0-9a-f]{40}$/);
  assert.equal(a1, chainAddressForUser("00000000-0000-0000-0000-000000000001"), "deterministic");
  assert.notEqual(
    a1,
    chainAddressForUser("00000000-0000-0000-0000-000000000002"),
    "different users → different addresses",
  );
  assert.equal(
    CHAIN_PLATFORM_ADDRESS,
    "0x0000000000000000000000000000000000000000",
    "platform vault defaults to zero address (ERC-721 mint semantics)",
  );
  assert.match(CHAIN_CONTRACT_ADDRESS, /^0x.{40}$/);
  assert.equal(CHAIN_MAX_SUPPLY, DEFAULT_MAX_SUPPLY, "default max supply 100000 (env unset)");
});

// === 8) Provider 工厂：未配置 CHAIN_PROVIDER → mock 模拟链 ===
test("chain: getChainProvider falls back to simulated mock", () => {
  const provider = getChainProvider();
  assert.equal(provider.id, "mock");
  assert.equal(provider.isSimulated, true);
});

// === 9) drizzle/0024 迁移文件：三表 + 唯一约束 + 供应不变量 + 单例种子 ===
test("migration: drizzle/0024_soul_cards.sql structural contract", () => {
  const sql = read("drizzle/0024_soul_cards.sql");
  assert.ok(exists("drizzle/0024_soul_cards.sql"), "migration file exists");
  for (const table of ["soul_cards", "chain_ledger", "chain_supply"]) {
    assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS "${table}"`), `creates ${table}`);
  }
  // 一宠一卡 / tokenId / 凭证编号 / txHash 全局唯一
  for (const c of [
    "soul_cards_pet_unique",
    "soul_cards_token_id_unique",
    "soul_cards_certificate_no_unique",
    "chain_ledger_tx_hash_unique",
  ]) {
    assert.ok(sql.includes(c), `unique constraint ${c}`);
  }
  // 供应硬顶与计数器不变量 + 单例种子（id=1）
  assert.ok(sql.includes("max_supply"), "max supply column");
  assert.ok(/INSERT INTO "chain_supply"[\s\S]*VALUES \(1\)/.test(sql), "singleton seed id=1");
  assert.ok(sql.includes("idx_soul_cards_owner"), "owner index");
  assert.ok(sql.includes("idx_chain_ledger_token"), "ledger token index");
});

// === 10) schema.ts 导出 + client.ts 运行时同步（SCHEMA_VERSION=6） ===
test("db: schema exports 3 tables; client.ts syncs DDL with SCHEMA_VERSION=6", () => {
  for (const table of [soulCards, chainLedger, chainSupply]) {
    assert.ok(table, "drizzle table defined");
  }
  assert.ok(soulCards.tokenId && soulCards.certificateNo && soulCards.aiPersonality);
  assert.ok(chainLedger.txHash && chainLedger.blockNumber && chainLedger.payload);
  assert.ok(chainSupply.maxSupply && chainSupply.nextTokenId && chainSupply.nextBlockNumber);

  const client = read("src/db/client.ts");
  // 版本号随后续 Phase 递增（Phase 2 起 =7，由 tests/aibi-platform.test.mjs 锚定）；
  // 本测试锚定 Phase 1 的注册痕迹：v6 变更日志注释 + 三表内嵌 DDL。
  assert.ok(client.includes("v6: Aibi Soul Card"), "v6 changelog comment present");
  assert.ok(client.includes('CREATE TABLE IF NOT EXISTS "soul_cards"'));
  assert.ok(client.includes('CREATE TABLE IF NOT EXISTS "chain_ledger"'));
  assert.ok(client.includes('CREATE TABLE IF NOT EXISTS "chain_supply"'));
  assert.ok(client.includes('INSERT INTO "chain_supply" ("id") VALUES (1) ON CONFLICT'));
  assert.ok(client.includes("idx_soul_cards_owner"));
  assert.ok(client.includes("idx_chain_ledger_card"));
});


// === 11) Service 契约：6 个导出函数 + 8 个业务错误码 + 事务编排锚点 ===
test("service: soul-card-service exports & error codes & tx orchestration", () => {
  const src = read("src/server/services/soul-card-service.ts");
  for (const fn of [
    "mintSoulCard",
    "burnSoulCard",
    "getSoulCardDetail",
    "listMySoulCards",
    "listMintablePets",
    "getChainStatus",
  ]) {
    assert.ok(src.includes(`export async function ${fn}`), `exports ${fn}`);
  }
  for (const code of [
    "PET_NOT_FOUND",
    "PET_NOT_OWNED",
    "PET_NOT_ACTIVE",
    "SOUL_CARD_EXISTS",
    "SUPPLY_EXHAUSTED",
    "CARD_NOT_FOUND",
    "CARD_NOT_OWNED",
    "CARD_ALREADY_BURNED",
  ]) {
    assert.ok(src.includes(`"${code}"`), `error code ${code}`);
  }
  // 链上总量控制锚点：原子分配 → 耗尽映射 → 记账
  assert.ok(src.includes("allocateMintSlot"), "mint allocates slot atomically");
  assert.ok(src.includes("allocateBurnSlot"), "burn allocates slot atomically");
  assert.ok(src.includes("db.transaction"), "runs inside DB transaction");
  assert.ok(src.includes("certificateNoForTokenId"), "cert no derived from tokenId");
});

// === 12) Controller 层：5 个路由文件 + 错误码 HTTP 映射 ===
test("controllers: thin routes exist; error mapper covers all codes", () => {
  for (const route of [
    "src/app/api/soul-cards/route.ts",
    "src/app/api/soul-cards/mint/route.ts",
    "src/app/api/soul-cards/[id]/route.ts",
    "src/app/api/soul-cards/[id]/burn/route.ts",
    "src/app/api/chain/status/route.ts",
  ]) {
    assert.ok(exists(route), `route exists: ${route}`);
    const src = read(route);
    assert.ok(src.includes('export const runtime = "nodejs"'), `${route} nodejs runtime`);
  }
  // 铸造/销毁需鉴权，详情与链状态公开读
  assert.ok(read("src/app/api/soul-cards/mint/route.ts").includes("getUserFromRequest"));
  assert.ok(read("src/app/api/soul-cards/[id]/burn/route.ts").includes("getUserFromRequest"));
  assert.ok(!read("src/app/api/chain/status/route.ts").includes("getUserFromRequest"),
    "chain status is public");
  assert.ok(!read("src/app/api/soul-cards/[id]/route.ts").includes("getUserFromRequest"),
    "card detail is public (verifiable certificate)");

  const mapper = read("src/server/http/soul-card-error.ts");
  for (const code of [
    "PET_NOT_FOUND", "PET_NOT_OWNED", "PET_NOT_ACTIVE", "SOUL_CARD_EXISTS",
    "SUPPLY_EXHAUSTED", "CARD_NOT_FOUND", "CARD_NOT_OWNED", "CARD_ALREADY_BURNED",
  ]) {
    assert.ok(mapper.includes(code), `mapper covers ${code}`);
  }
});

// === 13) i18n：soulCards 命名空间 + api 错误键 + nav 入口（双语） ===
test("i18n: zh/en soulCards section + api error keys + nav label", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  for (const [dict, loc] of [[zh, "zh"], [en, "en"]]) {
    const s = dict.soulCards;
    assert.ok(s, `${loc} has soulCards section`);
    for (const ns of [
      "supply", "collection", "mintable", "mint", "burn",
      "detail", "attrs", "certificate", "status", "txType", "stages",
    ]) {
      assert.ok(s[ns], `${loc} soulCards.${ns}`);
    }
    assert.equal(dict.nav.soulCards ? 1 : 0, 1, `${loc} nav.soulCards`);
    for (const key of [
      "soulCardPetNotFound", "soulCardPetNotYours", "soulCardPetInactive",
      "soulCardExists", "soulCardSupplyExhausted", "soulCardNotFound",
      "soulCardNotYours", "soulCardBurned", "soulCardLoadFailed",
      "soulCardMintFailed", "soulCardBurnFailed",
    ]) {
      assert.equal(typeof dict.api[key], "string", `${loc} api.${key}`);
    }
  }
  // 阶段文案与共享配置一致（单一事实源：soul-card-config.ts）
  assert.equal(zh.soulCards.stages.seed, GROWTH_STAGES[0].labelZh);
  assert.equal(zh.soulCards.stages.radiant, GROWTH_STAGES[3].labelZh);
  assert.equal(en.soulCards.stages.bloom, GROWTH_STAGES[2].labelEn);
});

// === 14) 前端接线：组件 / 页面 / 导航入口 ===
test("frontend: soul-card components + page + header nav wiring", () => {
  for (const comp of [
    "soul-card-types.ts",
    "soul-card-view.tsx",
    "soul-card-growth.tsx",
    "soul-card-attributes.tsx",
    "soul-card-certificate.tsx",
    "mint-soul-card-button.tsx",
    "soul-card-detail-modal.tsx",
    "soul-cards-client.tsx",
  ]) {
    assert.ok(exists(`src/components/soul-card/${comp}`), `component ${comp}`);
  }
  assert.ok(exists("src/app/[locale]/soul-cards/page.tsx"), "page exists");
  const header = read("src/components/layout/SiteHeader.tsx");
  assert.ok(header.includes('href: "/soul-cards"'), "header registers /soul-cards");
  assert.ok(header.includes('t("soulCards")'), "header uses nav.soulCards label");
  // 客户端鉴权策略：Bearer + localStorage（与 explore-v2 一致）
  const clientComp = read("src/components/soul-card/soul-cards-client.tsx");
  assert.ok(clientComp.includes("aiabw_token"), "reads aiabw_token");
  assert.ok(clientComp.includes("Bearer"), "sends Bearer token");
});

// === 15) Solidity 合约结构（测试网就绪，主网未部署） ===
test("contract: AibiSoulCard.sol scarcity & role structure", () => {
  assert.ok(exists("contracts/AibiSoulCard.sol"), "contract exists");
  const sol = read("contracts/AibiSoulCard.sol");
  for (const anchor of [
    "MAX_SUPPLY",
    "MINTER_ROLE",
    "certificateNoOf",
    "soulStateHashOf",
    "function mint",
    "function burn",
  ]) {
    assert.ok(sol.includes(anchor), `contract has ${anchor}`);
  }
  const readme = read("contracts/README.md");
  assert.ok(/sepolia/i.test(readme), "README documents sepolia deploy");
});


// === 16) EvmChainProvider：托管铸造 + 真实回执映射（注入假 viem client，无网络） ===
const EVM_CUSTODY = "0x1111111111111111111111111111111111111111";
const EVM_CONTRACT = "0x2222222222222222222222222222222222222222";
const EVM_SIGNER = "0x3333333333333333333333333333333333333333";
const EVM_USER = "0x4444444444444444444444444444444444444444";
const EVM_TX = "0x" + "ab".repeat(32);

function evmLog(eventName, args) {
  // viem 2.x 无 encodeEventLog：topics=签名+indexed 参数，data=非 indexed 参数 ABI 编码
  const event = AIBI_SOUL_CARD_ABI.find(
    (x) => x.type === "event" && x.name === eventName,
  );
  const indexed = event.inputs.filter((i) => i.indexed);
  const plain = event.inputs.filter((i) => !i.indexed);
  const topics = encodeEventTopics({
    abi: AIBI_SOUL_CARD_ABI,
    eventName,
    args: Object.fromEntries(indexed.map((i) => [i.name, args[i.name]])),
  });
  const data = encodeAbiParameters(
    plain,
    plain.map((i) => args[i.name]),
  );
  return { address: EVM_CONTRACT, topics, data };
}

function fakeEvmDeps({ logs, status = "success", blockNumber = 9000001n }) {
  const calls = [];
  return {
    calls,
    account: { address: EVM_SIGNER },
    walletClient: {
      writeContract: async (params) => {
        calls.push(params);
        return EVM_TX;
      },
    },
    publicClient: {
      waitForTransactionReceipt: async () => ({
        status,
        blockNumber,
        logs,
        transactionHash: EVM_TX,
      }),
    },
    contractAddress: EVM_CONTRACT,
    custodyAddress: EVM_CUSTODY,
  };
}

const MINT_METADATA = {
  name: "测试卡",
  description: "d",
  image: "https://example.com/x.png",
  attributes: [],
};

test("evm: custodial mint encodes (custody, certNo) & maps real receipt", async () => {
  const deps = fakeEvmDeps({
    logs: [
      evmLog("SoulMinted", {
        tokenId: 7n,
        to: EVM_CUSTODY,
        certificateNo: "AIBI-000007",
        metadataURI: "https://aiabw.com/api/chain/metadata/7",
      }),
    ],
  });
  const provider = createEvmChainProvider(deps);
  assert.equal(provider.id, "evm");
  assert.equal(provider.isSimulated, false);
  assert.equal(provider.contractAddress, EVM_CONTRACT);
  const receipt = await provider.mint({
    toAddress: EVM_USER,
    tokenId: 7,
    blockNumber: 100,
    metadata: MINT_METADATA,
  });
  const call = deps.calls[0];
  assert.equal(call.functionName, "mint");
  // 托管铸造：链上接收方 = 平台托管地址（而非用户 sha256 派生地址）；凭证号由 tokenId 派生
  assert.deepEqual([...call.args], [EVM_CUSTODY, "AIBI-000007"]);
  assert.equal(call.address, EVM_CONTRACT);
  // 回执取真链数据：txHash/区块号来自链上确认，而非链下分配值
  assert.equal(receipt.txHash, EVM_TX);
  assert.equal(receipt.blockNumber, 9000001);
  assert.equal(receipt.tokenId, 7);
  assert.equal(receipt.txType, "mint");
  assert.equal(receipt.status, "confirmed");
});

test("evm: tokenId mismatch guard throws (offchain rollback for reconciliation)", async () => {
  const deps = fakeEvmDeps({
    logs: [
      evmLog("SoulMinted", {
        tokenId: 8n,
        to: EVM_CUSTODY,
        certificateNo: "AIBI-000008",
        metadataURI: "u",
      }),
    ],
  });
  const provider = createEvmChainProvider(deps);
  await assert.rejects(
    () =>
      provider.mint({
        toAddress: EVM_USER,
        tokenId: 7,
        blockNumber: 100,
        metadata: MINT_METADATA,
      }),
    /tokenId mismatch \(mint\): offchain=7 onchain=8/,
  );
});

test("evm: reverted tx throws; burn & transfer encode correctly", async () => {
  // 链上回滚 → 抛错（service DB 事务整体回滚）
  const reverted = createEvmChainProvider(
    fakeEvmDeps({ status: "reverted", logs: [] }),
  );
  await assert.rejects(
    () => reverted.burn({ tokenId: 7, blockNumber: 101 }),
    /burn tx reverted onchain/,
  );
  // burn：合约 burn(tokenId)，SoulBurned 事件对账
  const burnDeps = fakeEvmDeps({
    logs: [evmLog("SoulBurned", { tokenId: 7n, from: EVM_CUSTODY })],
  });
  const burnProvider = createEvmChainProvider(burnDeps);
  const burnReceipt = await burnProvider.burn({ tokenId: 7, blockNumber: 101 });
  assert.equal(burnDeps.calls[0].functionName, "burn");
  assert.deepEqual([...burnDeps.calls[0].args], [7n]);
  assert.equal(burnReceipt.txType, "burn");
  assert.equal(burnReceipt.tokenId, 7);
  // transfer：托管 → 用户真实钱包，safeTransferFrom + ERC-721 Transfer 事件对账
  const transferDeps = fakeEvmDeps({
    logs: [evmLog("Transfer", { from: EVM_CUSTODY, to: EVM_USER, tokenId: 7n })],
  });
  const transferProvider = createEvmChainProvider(transferDeps);
  const transferReceipt = await transferProvider.transfer({
    fromAddress: EVM_CUSTODY,
    toAddress: EVM_USER,
    tokenId: 7,
    blockNumber: 102,
  });
  assert.equal(transferDeps.calls[0].functionName, "safeTransferFrom");
  assert.deepEqual([...transferDeps.calls[0].args], [EVM_CUSTODY, EVM_USER, 7n]);
  assert.equal(transferReceipt.txType, "transfer");
});



// === 17) Phase 2 接线契约：config 三要素 / 工厂 evm / 咨询锁 / metadata 端点 / 部署脚本 ===
test("phase2 wiring: config + factory + advisory lock + metadata route + deploy script", () => {
  const config = read("src/server/chain/chain-config.ts");
  for (const key of [
    "CHAIN_RPC_URL",
    "CHAIN_DEPLOYER_KEY",
    "CHAIN_CUSTODY_ADDRESS",
    "isEvmChainConfigured",
  ]) {
    assert.ok(config.includes(key), `chain-config has ${key}`);
  }
  const factory = read("src/server/chain/get-chain-provider.ts");
  assert.ok(factory.includes("getEvmChainProvider"), "factory wires evm provider");
  assert.ok(factory.includes("isEvmChainConfigured"), "factory guards evm config");
  assert.ok(factory.includes("回退 mock"), "factory falls back to mock when unconfigured");

  const ledgerRepo = read("src/server/repositories/chain-ledger-repository.ts");
  assert.ok(
    ledgerRepo.includes("pg_advisory_xact_lock"),
    "mint allocation holds advisory lock (offchain order == onchain order)",
  );

  assert.ok(
    exists("src/app/api/chain/metadata/[tokenId]/route.ts"),
    "metadata route exists (contract baseURI target)",
  );
  const meta = read("src/app/api/chain/metadata/[tokenId]/route.ts");
  assert.ok(meta.includes('export const runtime = "nodejs"'));
  assert.ok(meta.includes("findSoulCardByTokenId"), "metadata resolves by tokenId");
  assert.ok(
    read("src/server/repositories/soul-card-repository.ts").includes(
      "findSoulCardByTokenId",
    ),
  );
  assert.ok(
    read("src/server/services/soul-card-service.ts").includes(
      "export function buildTokenMetadata",
    ),
    "metadata builder exported for tokenURI route",
  );

  // evm 模式需等待出块：mint/burn 路由放宽函数执行时限
  for (const r of [
    "src/app/api/soul-cards/mint/route.ts",
    "src/app/api/soul-cards/[id]/burn/route.ts",
  ]) {
    assert.ok(read(r).includes("maxDuration = 60"), `${r} sets maxDuration=60`);
  }

  // 部署工具链（独立 contracts/ 工程，勿混入 Next.js 主仓 deps）
  assert.ok(exists("contracts/deploy.mjs"), "deploy script exists");
  const deploy = read("contracts/deploy.mjs");
  for (const anchor of [
    "solc.compile",
    "sepolia",
    "CHAIN_DEPLOYER_KEY",
    "deployContract",
    "MAX_SUPPLY",
  ]) {
    assert.ok(deploy.includes(anchor), `deploy script has ${anchor}`);
  }
  const contractsPkg = JSON.parse(read("contracts/package.json"));
  assert.ok(
    contractsPkg.devDependencies["@openzeppelin/contracts"],
    "OZ contracts dep in isolated contracts project",
  );
  assert.ok(contractsPkg.devDependencies.solc, "solc dep in isolated project");
  assert.ok(
    !JSON.parse(read("package.json")).dependencies.solc,
    "solc stays out of Next.js deps",
  );

  const envExample = read(".env.example");
  for (const key of [
    "CHAIN_PROVIDER",
    "CHAIN_RPC_URL",
    "CHAIN_CONTRACT_ADDRESS",
    "CHAIN_DEPLOYER_KEY",
    "CHAIN_CUSTODY_ADDRESS",
  ]) {
    assert.ok(envExample.includes(key), `.env.example documents ${key}`);
  }
});
