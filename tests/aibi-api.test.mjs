/**
 * 契约测试：艾比平台 Phase 4 —— API 接口层（指令集 4.1~4.3，2026-09-30）
 * 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/aibi-api.test.mjs
 * 覆盖：13 条路由存在性 / zod 校验 / {data}+{code,message} 统一格式 / 事务包裹 /
 *       权限校验（mint 管理员、burn 归属）/ 并发原子守卫 / 成长与融合规则 / v9 列补全。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyGrowth,
  rollPackRarity,
  INTERACT_RULES,
  ENERGY_MAX,
  AFFINITY_MAX,
  EXP_PER_LEVEL,
  FUSION_MIN,
  FUSION_MAX,
} from "../src/lib/aibi-service.ts";
import { getAibiPack } from "../src/lib/aibi-catalog.ts";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const ROUTES = {
  mint: read("../src/app/api/aibi/mint/route.ts"),
  burn: read("../src/app/api/aibi/burn/route.ts"),
  fuse: read("../src/app/api/aibi/fuse/route.ts"),
  owner: read("../src/app/api/aibi/owner/[wallet]/route.ts"),
  supply: read("../src/app/api/aibi/supply/route.ts"),
  packList: read("../src/app/api/pack/list/route.ts"),
  packBuy: read("../src/app/api/pack/buy/route.ts"),
  packOpen: read("../src/app/api/pack/open/route.ts"),
  itemList: read("../src/app/api/item/list/route.ts"),
  itemBuy: read("../src/app/api/item/buy/route.ts"),
  bagItems: read("../src/app/api/bag/items/route.ts"),
  bagUse: read("../src/app/api/bag/use/route.ts"),
  interact: read("../src/app/api/interact/route.ts"),
};
const apiLib = read("../src/lib/aibi-api.ts");
const errorsLib = read("../src/lib/aibi-errors.ts");
const service = read("../src/lib/aibi-service.ts");
const client = read("../src/db/client.ts");
const schema = read("../src/db/schema.ts");
const migration27 = read("../drizzle/0027_aibi_phase4_columns.sql");
const http = read("../scripts/aibi-api.http");

// ============ 4.1+4.2+4.3 路由存在性（13 条） ============
test("routes: 13 条接口全部存在且导出处理方法", () => {
  const expect = {
    mint: "POST", burn: "POST", fuse: "POST", owner: "GET", supply: "GET",
    packList: "GET", packBuy: "POST", packOpen: "POST", itemList: "GET",
    itemBuy: "POST", bagItems: "GET", bagUse: "POST", interact: "POST",
  };
  for (const [k, method] of Object.entries(expect)) {
    assert.ok(ROUTES[k].includes(`export async function ${method}`), `${k} 导出 ${method}`);
    assert.ok(ROUTES[k].includes('runtime = "nodejs"'), `${k} nodejs runtime`);
  }
});

// ============ 统一返回格式（成功 {data} / 失败 {code,message}） ============
test("format: 全部路由经 aibiOk/aibiFail/aibiCatch 返回统一格式", () => {
  for (const [k, c] of Object.entries(ROUTES)) {
    assert.ok(c.includes("aibiOk("), `${k} 成功 {data}`);
    assert.ok(c.includes("aibiFail(") || c.includes("aibiCatch("), `${k} 失败 {code,message}`);
    assert.ok(c.includes("@/lib/aibi-api"), `${k} 引用统一约定模块`);
  }
  assert.ok(apiLib.includes("{ data }"), "aibiOk → { data }");
  assert.ok(apiLib.includes("{ code, message,"), "aibiFail → { code, message }");
  assert.ok(apiLib.includes("resolveLocale"), "message 双语");
  for (const code of ["UNAUTHORIZED", "FORBIDDEN", "VALIDATION_ERROR", "TOKEN_NOT_FOUND", "TOKEN_NOT_OWNED", "TOKEN_NOT_MINTED", "INSUFFICIENT_POINTS", "INSUFFICIENT_ITEM", "NOT_ENOUGH_ENERGY", "FUSION_INVALID", "PACK_NOT_FOUND", "ITEM_NOT_FOUND", "INTERNAL_ERROR"]) {
    assert.ok(apiLib.includes(code), `错误目录含 ${code}`);
  }
});

// ============ zod 入参校验 ============
test("zod: 全部写接口入参经 zod 校验", () => {
  for (const k of ["mint", "burn", "fuse", "packBuy", "packOpen", "itemBuy", "bagUse", "interact"]) {
    assert.ok(ROUTES[k].includes('from "zod"'), `${k} 引入 zod`);
    assert.ok(ROUTES[k].includes("z.object"), `${k} 定义 schema`);
    assert.ok(ROUTES[k].includes("safeParse") || ROUTES[k].includes("parseBody"), `${k} 执行校验`);
  }
  assert.ok(apiLib.includes("z.flattenError"), "校验失败返回字段级 details");
});

// ============ 事务包裹（数据库操作必须带事务） ============
test("tx: 全部写接口 BEGIN/COMMIT/ROLLBACK 事务包裹", () => {
  for (const k of ["mint", "burn", "fuse", "packBuy", "packOpen", "itemBuy", "bagUse", "interact"]) {
    assert.ok(ROUTES[k].includes('"BEGIN"'), `${k} BEGIN`);
    assert.ok(ROUTES[k].includes('"COMMIT"'), `${k} COMMIT`);
    assert.ok(ROUTES[k].includes('"ROLLBACK"'), `${k} ROLLBACK`);
    assert.ok(ROUTES[k].includes("client.release()"), `${k} 连接归还`);
  }
});

// ============ 敏感接口权限校验 ============
test("perm: mint 仅管理员 + burn 归属校验", () => {
  assert.ok(ROUTES.mint.includes('rows[0]?.role !== "admin"'), "mint 管理员角色校验");
  assert.ok(ROUTES.mint.includes('aibiFail("FORBIDDEN", 403'), "非管理员 403");
  assert.ok(ROUTES.mint.includes('z.literal("admin_mint")'), "公开铸造仅允许 admin_mint 来源");

// ============ 4.1 代币服务核心 ============
test("service: AIBI-000001 发号 / 日志 / 快照", () => {
  assert.ok(service.includes("nextval('aibi_token_seq')"), "序列发号（并发安全）");
  assert.ok(service.includes('padStart(6, "0")'), "AIBI-000001 六位编号");
  assert.ok(service.includes("species.personalityTemplate"), "性格档案随物种模板");
  assert.ok(service.includes('INSERT INTO mint_logs'), "增发日志");
  assert.ok(service.includes('INSERT INTO burn_logs'), "销毁日志");
  assert.ok(service.includes('INSERT INTO supply_snapshots'), "事件驱动快照（文档 2.4）");
  assert.ok(service.includes("AND status='minted'"), "销毁原子抢占 minted→burned");
  assert.ok(service.includes("count(*)::int FROM mint_logs"), "totalMinted 日志权威口径");
  assert.ok(service.includes("status = 'minted') AS \"currentSupply\""), "currentSupply 实时计数");
});

test("service: 融合规则（素材销毁 + 最高稀有度 + 事务行锁）", () => {
  assert.equal(FUSION_MIN, 2);
  assert.equal(FUSION_MAX, 5);
  assert.ok(service.includes("FOR UPDATE"), "素材行锁防并发融合");
  assert.ok(service.includes('"fusion_consume"'), "素材销毁 reason");
  assert.ok(service.includes('"fusion_generate"'), "结果铸造 source");
  assert.ok(service.includes("ra.sortOrder > topSort"), "结果稀有度=素材最高档");
  assert.ok(ROUTES.fuse.includes("new Set(body.tokenIds).size"), "路由去重校验");
});

test("service: 卡包掷签 + 新手包勘误降级", () => {
  assert.ok(service.includes("allowedRarities"), "掷出档位须在产出范围内");
  assert.ok(service.includes("sortOrder ?? 0"), "降级取范围内最高档");
  const starter = getAibiPack("starter");
  const summon = getAibiPack("summon");
  const origin = Math.random;
  try {
    Math.random = () => 0.1;   // 落 common（权重 60%）
    assert.equal(rollPackRarity(starter), "common");
    Math.random = () => 0.95;  // 落 epic（90~100%）→ 不在 allowedRarities → 降级 rare
    assert.equal(rollPackRarity(starter), "rare", "epic 掷出降级到范围内最高档 rare");
    Math.random = () => 0.999; // 传说召唤包落 mythic（权重 60%）
    assert.equal(rollPackRarity(summon), "mythic");
  } finally {
    Math.random = origin;
  }
});

// ============ 成长规则（纯函数单测） ============
test("growth: applyGrowth 升级/夹取/心情规则", () => {
  assert.equal(EXP_PER_LEVEL, 100);
  const base = { personalityType: "好奇", mood: "平静", affinity: 0, energy: 50, growthLevel: 1, growthExp: 0 };
  const up = applyGrowth(base, { exp: 150 });
  assert.deepEqual([up.growthLevel, up.growthExp], [2, 50], "150 经验升 1 级余 50");
  const up2 = applyGrowth(base, { exp: 250 });
  assert.deepEqual([up2.growthLevel, up2.growthExp], [3, 50], "250 经验连升 2 级");
  const capped = applyGrowth(base, { energy: 999, affinity: 999 });
  assert.equal(capped.energy, ENERGY_MAX, "能量封顶");
  assert.equal(capped.affinity, AFFINITY_MAX, "亲密度封顶");
  const floored = applyGrowth(base, { energy: -999, affinity: -999 });
  assert.equal(floored.energy, 0, "能量下限 0");
  assert.equal(floored.affinity, 0, "亲密度下限 0");
  assert.equal(applyGrowth(base, {}).mood, "平静", "无 mood 增量保持原心情");
});

test("growth: 互动四动作数值表（文档 4.3 规则实现）", () => {
  assert.deepEqual(Object.keys(INTERACT_RULES).sort(), ["feed", "play", "talk", "train"]);
  assert.equal(INTERACT_RULES.feed.energy, 20);
  assert.equal(INTERACT_RULES.train.energy, -15);

// ============ 4.2 卡包/道具/背包路由要点 ============
test("pack: 购买原子扣分 + 背包入库 + 开包消耗防并发", () => {
  assert.ok(ROUTES.packBuy.includes("points >= $1"), "原子扣费守卫");
  assert.ok(ROUTES.packBuy.includes("'aibi_pack_buy'"), "积分流水 reason");
  assert.ok(ROUTES.packBuy.includes("'pack:' || $2"), "卡包背包键 pack: 前缀");
  assert.ok(ROUTES.packBuy.includes("'aibi_pack'"), "背包来源标记");
  assert.ok(ROUTES.packBuy.includes('"INSUFFICIENT_POINTS", 402'), "积分不足 402");
  assert.ok(ROUTES.packOpen.includes("FOR UPDATE SKIP LOCKED"), "开包原子消耗防双开");
  assert.ok(ROUTES.packOpen.includes('"INSUFFICIENT_ITEM", 400'), "无包可开 400");
  assert.ok(ROUTES.packOpen.includes('"pack_open"'), "开包铸造来源");
  assert.ok(ROUTES.packOpen.includes("rollPackRarity") && ROUTES.packOpen.includes("pickSpeciesForRarity"), "掷签+物种抽取");
});

test("item: 购买/背包/使用 闭环", () => {
  assert.ok(ROUTES.itemBuy.includes("points >= $1") && ROUTES.itemBuy.includes("'aibi_item_buy'"), "道具原子扣费+流水");
  assert.ok(ROUTES.itemBuy.includes("'aibi_item'"), "道具背包来源标记");
  assert.ok(ROUTES.bagItems.includes("IN ('aibi_pack', 'aibi_item')"), "背包聚合两类库存");
  assert.ok(ROUTES.bagItems.includes('replace(/^pack:/, "")'), "背包还原 packId");
  assert.ok(ROUTES.bagUse.includes("FOR UPDATE SKIP LOCKED"), "道具原子消耗");
  assert.ok(ROUTES.bagUse.includes("applyGrowth"), "effectPayload 结算成长");
  assert.ok(ROUTES.bagUse.includes('"evolve"'), "进化石 action=evolve");
  assert.ok(ROUTES.bagUse.includes("焕然一新"), "修复晶片满恢复心情");
  assert.ok(ROUTES.bagUse.includes("aibi_growth_logs"), "成长日志前后快照");
});

// ============ 4.3 互动路由（/api/interact 扩展，旧流程不变） ============
test("interact: tokenId 分支 + 旧 adoptionId 流程保留", () => {
  assert.ok(ROUTES.interact.includes("body?.tokenId"), "tokenId 触发艾比分支");
  assert.ok(ROUTES.interact.includes("handleAibiInteract"), "艾比互动处理器");
  assert.ok(ROUTES.interact.includes("adoptionId"), "旧版领养互动保留");
  assert.ok(ROUTES.interact.includes("monthlyPoints"), "旧版月度积分逻辑保留");
  assert.ok(ROUTES.interact.includes('z.enum(["feed", "train", "talk", "play"])'), "动作枚举 zod 校验");
  assert.ok(ROUTES.interact.includes("NOT_ENOUGH_ENERGY"), "精力不足拒绝");
  assert.ok(ROUTES.interact.includes("INTERACT_RULES[action]"), "规则表驱动");
  assert.ok(ROUTES.interact.includes("leveledUp"), "返回升级标记");
  assert.ok(ROUTES.interact.includes("FOR UPDATE"), "互动行锁");
});

// ============ 按地址查询 / 供应看板 ============
test("owner/supply: 双路径查询 + 快照", () => {
  assert.ok(ROUTES.owner.includes("^0x[0-9a-f]{4,}$"), "0x 钱包地址识别");
  assert.ok(ROUTES.owner.includes("user_wallets"), "钱包→持有人反查");
  assert.ok(ROUTES.owner.includes("0-9a-f]{12}"), "UUID 直接按 owner_id 查询");

// ============ v9 列补全（drizzle/0027 + client.ts 顺序保证） ============
test("v9: price_points / growth 列 / 发号序列", () => {
  const v9 = Number(client.match(/SCHEMA_VERSION\s*=\s*(\d+)/)?.[1]);
  assert.ok(v9 >= 9, `SCHEMA_VERSION 需 >=9（实际 ${v9}，后续版本迭代继续累加）`);
  assert.ok(migration27.includes('ALTER TABLE "aibi_items" ADD COLUMN IF NOT EXISTS "price_points"'), "0027 道具价格列");
  assert.ok(migration27.includes('"growth_level"') && migration27.includes('"growth_exp"'), "0027 成长列");
  assert.ok(migration27.includes('CREATE SEQUENCE IF NOT EXISTS "aibi_token_seq"'), "0027 发号序列");
  assert.ok(migration27.includes("回滚"), "0027 回滚方案");
  // ALTER 必须排在目录种子之前（旧库 v8 无列时种子 upsert 会失败）
  const alterIdx = client.indexOf('ALTER TABLE "aibi_items" ADD COLUMN IF NOT EXISTS "price_points"');
  const seedIdx = client.indexOf("...buildAibiCatalogSeedSql()");
  assert.ok(alterIdx > -1 && seedIdx > -1 && alterIdx < seedIdx, "client.ts 内 ALTER 先于种子执行");
  assert.ok(schema.includes("pricePoints: integer('price_points')"), "schema.ts 道具价格列");
  assert.ok(schema.includes("growthLevel: integer('growth_level')"), "schema.ts 成长等级列");
  assert.ok(schema.includes("growthExp: integer('growth_exp')"), "schema.ts 成长经验列");
});

// ============ 接口测试用例文件（执行要求：HTTP 文件或 curl） ============
test("http: scripts/aibi-api.http 覆盖 13 条接口与负面用例", () => {
  for (const path of [
    "/api/pack/list", "/api/pack/buy", "/api/pack/open",
    "/api/item/list", "/api/item/buy", "/api/bag/items", "/api/bag/use",
    "/api/aibi/mint", "/api/aibi/burn", "/api/aibi/fuse",
    "/api/aibi/owner/", "/api/aibi/supply", "/api/interact",
  ]) {
    assert.ok(http.includes(path), `http 用例含 ${path}`);
  }
  assert.ok(http.includes("INSUFFICIENT_POINTS") && http.includes("TOKEN_NOT_OWNED"), "负面用例说明");
});

// ============ 零依赖错误基类（service 不依赖 next/server，纯函数可测） ============
test("arch: AibiError 独立零依赖模块", () => {
  assert.ok(errorsLib.includes("export class AibiError"), "aibi-errors.ts 定义 AibiError");
  assert.ok(!errorsLib.includes("next/server"), "错误基类无 Next 依赖");
  assert.ok(service.includes('from "./aibi-errors"'), "service 引用零依赖错误基类");
});

  assert.ok(ROUTES.owner.includes("aibi_personalities"), "返回成长/性格档案");
  assert.ok(ROUTES.supply.includes("readSupply"), "供应统计复用服务口径");
  assert.ok(ROUTES.supply.includes("supply_snapshots"), "最新快照");
});

  assert.equal(INTERACT_RULES.train.exp, 20);
  assert.equal(INTERACT_RULES.talk.affinity, 5);
  assert.equal(INTERACT_RULES.play.exp, 10);
  assert.ok(INTERACT_RULES.train.minEnergy === 15 && INTERACT_RULES.play.minEnergy === 10, "精力门槛防倒扣");
});

  assert.ok(ROUTES.burn.includes("TOKEN_NOT_OWNED"), "burn 非持有人且非管理员 → 403");
  assert.ok(ROUTES.burn.includes('"user_burn"'), "持有人默认 user_burn");
  for (const k of ["mint", "burn", "fuse", "packBuy", "packOpen", "itemBuy", "bagItems", "bagUse", "interact"]) {
    assert.ok(ROUTES[k].includes("getUserFromRequest"), `${k} 登录态校验`);
    assert.ok(ROUTES[k].includes('"UNAUTHORIZED", 401'), `${k} 未登录 401`);
  }
});
