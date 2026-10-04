// NFR 繁育/转赠 UI（2026-10-08）契约测试：
//  1) GET /api/pets/collectibles：个体实例端点（鉴权前置 401 + 双冷却字段）；
//  2) /api/pets/transfer：toEmail 邮箱解析 + transferSelf 自赠护栏（toUserId 旧契约保留）；
//  3) NfrGalleryPanel：保留 /api/gallery?mine=1 原请求，叠加实例数据源与双按钮；
//  4) 繁育弹窗：同物种亲本池 + 恰好 2 只 + BREED_COST 与 genetics.ts 同步 + 冷却禁用；
//  5) 转赠弹窗：选个体 → 邮箱 → 二次确认 → toEmail 提交；
//  6) i18n：collection.nfr 新增子命名空间 zh/en 深键对齐 + api.transferSelf 双语；
//  7) 生产冒烟脚本覆盖新端点（50 步）。
// 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/nfr-actions.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

test("collectibles API: 鉴权前置 401 + 个体维度字段（id/hashId/双冷却）", () => {
  const api = read("src/app/api/pets/collectibles/route.ts");
  assert.ok(api.includes("export async function GET"), "GET 导出");
  assert.ok(api.includes('runtime = "nodejs"'), "nodejs runtime");
  const authIdx = api.indexOf("getUserFromRequest(req)");
  const schemaIdx = api.indexOf("ensureDbSchemaOnce()");
  assert.ok(authIdx > -1 && schemaIdx > -1 && authIdx < schemaIdx, "鉴权先于 schema 同步");
  assert.ok(api.includes("{ status: 401 }"), "未登录 401");
  assert.ok(api.includes("FROM user_collectibles uc"), "数据源 user_collectibles");
  assert.ok(api.includes("JOIN digital_collectibles dc"), "JOIN 藏品定义");
  assert.ok(api.includes("uc.owner_id = $1"), "按当前用户过滤");
  assert.ok(api.includes("uc.status = 'active'"), "只返回 active");
  for (const f of ["lockedUntil", "breedCooldownUntil", "hashId", "generation", "speciesId"]) {
    assert.ok(api.includes(f), `响应字段 ${f}`);
  }
});

test("transfer API: toUsername 昵称解析（UI 主路径）+ toEmail 兼容 + transferSelf 护栏", () => {
  const api = read("src/app/api/pets/transfer/route.ts");
  assert.ok(api.includes("body?.toUsername"), "接收 toUsername 参数");
  assert.ok(api.includes("SELECT id FROM users WHERE username = $1"), "按公开昵称解析接收者（邮箱隐私不对外，drizzle/0022）");
  assert.ok(api.includes("body?.toEmail"), "toEmail 后端兼容路径保留");
  assert.ok(api.includes('apiError(locale, "transferSelf")'), "自我转赠 400 护栏");
  assert.ok(api.includes("SELECT id FROM users WHERE id = $1"), "toUserId 旧路径保留（verify-nfr E2E 兼容）");
  assert.ok(api.includes("receiverId === user.id"), "护栏比较接收者与本人");
  assert.ok(api.includes("newOwnerId: receiverId"), "响应使用解析后的 receiverId");
});

test("panel: 保留 gallery?mine=1 原请求 + 叠加实例源 + 双按钮 + 双弹窗", () => {
  const panel = read("src/components/collection/nfr-gallery-panel.tsx");
  assert.ok(panel.includes('fetch("/api/gallery?mine=1"'), "定义级数据源保持原样");
  assert.ok(panel.includes('fetch("/api/pets/collectibles"'), "个体实例数据源");
  assert.ok(panel.includes('t("actions.breed")'), "繁育按钮");
  assert.ok(panel.includes('t("actions.transfer")'), "转赠按钮");
  assert.ok(panel.includes("<NfrBreedModal"), "挂载繁育弹窗");
  assert.ok(panel.includes("<NfrTransferModal"), "挂载转赠弹窗");
  assert.ok(panel.includes("instances.filter((i) => i.collectibleId === it.id)"), "按定义分组实例");
});

test("breed modal: 同物种亲本池 + 恰好 2 只 + 冷却禁用 + POST parentIds", () => {
  const modal = read("src/components/collection/nfr-breed-modal.tsx");
  assert.ok(modal.includes("i.speciesId === item.speciesId"), "亲本池按同物种过滤");
  assert.ok(modal.includes("selected.length !== 2"), "恰好 2 只校验");
  assert.ok(modal.includes('fetch("/api/pets/breed"'), "提交 /api/pets/breed");
  assert.ok(modal.includes("parentIds: selected"), "parentIds 请求体");
  assert.ok(modal.includes("breedCooldownUntil"), "繁育冷却字段驱动禁用");
  assert.ok(modal.includes("useNow("), "秒级倒计时刷新");
  assert.ok(modal.includes("formatRemaining("), "剩余时间文本");
  assert.ok(modal.includes("errorStatus === 402"), "积分不足充值引导");
  assert.ok(modal.includes('href="/points"'), "充值入口链 /points");
});

test("breed modal: BREED_COST_POINTS 与 genetics.ts BREED_COST 同步（200）", () => {
  const modal = read("src/components/collection/nfr-breed-modal.tsx");
  const genetics = read("src/lib/genetics.ts");
  const costInGenetics = Number(genetics.match(/BREED_COST = (\d+)/)?.[1]);
  const costInModal = Number(modal.match(/BREED_COST_POINTS = (\d+)/)?.[1]);
  assert.ok(costInGenetics > 0, "genetics.ts BREED_COST 可解析");
  assert.equal(costInModal, costInGenetics, "弹窗展示成本必须与服务端扣费一致");
});

test("transfer modal: 选个体 → 昵称 → 二次确认 → toUsername 提交 + 冷却禁用", () => {
  const modal = read("src/components/collection/nfr-transfer-modal.tsx");
  assert.ok(modal.includes('"pick" | "confirm" | "done"'), "三步状态机");
  assert.ok(modal.includes('fetch("/api/pets/transfer"'), "提交 /api/pets/transfer");
  assert.ok(modal.includes("toUsername: target.trim()"), "toUsername 请求体（昵称隐私对齐）");
  assert.ok(!modal.includes("EMAIL_RE"), "不再要求邮箱格式");
  assert.ok(modal.includes("target.trim().length >= 2"), "昵称最短长度预检");
  assert.ok(modal.includes("collectibleId: chosen.id"), "作用于所选个体实例");
  assert.ok(modal.includes("confirmDesc"), "二次确认文案");
  assert.ok(modal.includes("lockedUntil"), "转赠冷却字段驱动禁用");
});

test("i18n: collection.nfr 新增子命名空间 zh/en 深键对齐 + api.transferSelf 双语", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  const flatten = (obj, prefix = "") =>
    Object.entries(obj ?? {}).flatMap(([k, v]) =>
      v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );
  for (const ns of ["actions", "breed", "transfer", "common"]) {
    const zk = flatten(zh.collection?.nfr?.[ns]).sort();
    const ek = flatten(en.collection?.nfr?.[ns]).sort();
    assert.ok(zk.length > 0, `zh collection.nfr.${ns} 非空`);
    assert.deepEqual(zk, ek, `collection.nfr.${ns} zh/en 键集合必须一致`);
  }
  assert.ok(zh.api?.transferSelf && en.api?.transferSelf, "api.transferSelf 双语存在");
});

test("smoke: 生产冒烟覆盖新端点（步骤 45-50 + 总数 52）", () => {
  const smoke = read("scripts/smoke-production.mjs");
  assert.ok(smoke.includes('api("/api/pets/collectibles")'), "collectibles 未登录 401 步骤");
  assert.ok(smoke.includes('api("/api/pets/breed"'), "breed 步骤");
  assert.ok(smoke.includes('api("/api/pets/transfer"'), "transfer 步骤");
  assert.ok(smoke.includes("stepNo === 52"), "总步数断言更新为 52（2026-10-13 51-52 断签补签用例）");
});
