/**
 * 契约测试 · 物种视觉注册表 + 状态机契约解耦（通用宠物状态机 · 换皮层）
 *
 *  A) species-visuals 注册表：persian 条目 / resolveSpeciesVisual 命中与派生 / 默认回退
 *     （雪豹显示自己的立绘，绝不复用橘猫素材——「雪豹播橘猫」修复锁定）；
 *  B) sm-contract 纯契约模块：5 Trigger / 别名映射 / inferMood 迁入 / 客户端安全；
 *  C) 解耦红线：pet-stage 不再 value-import pet-play-config、pet-play-config 不再 import
 *     characters（prompt 零进客户端 bundle）、characters 视觉字段移除；
 *  D) 路由接线：play/movie 按 speciesId 解析视觉 + 按 rivePath 逐路径探测（非全局布尔）；
 *  E) 前端接线：pet-stage 注册表驱动（rivePath 拉取 / 立绘换皮 / 场景主题类）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SCENE_THEME,
  resolveSpeciesVisual,
  SPECIES_VISUALS,
} from "../src/lib/pets/species-visuals.ts";
import {
  ACTION_TRIGGER_ALIAS,
  inferMood,
  PET_SM_TRIGGERS,
  RIVE_ASSET_NAME,
} from "../src/lib/pets/sm-contract.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ───────────── A1) 注册表结构 ─────────────
test("species-visuals(A1): persian 注册条目 + 每条目字段完整", () => {
  const v = SPECIES_VISUALS.persian;
  assert.ok(v, "persian 条目存在（打工橘猫）");
  assert.equal(v.rivePath, RIVE_ASSET_NAME, "rivePath = 契约资产 key");
  assert.equal(v.staticImage, "/avatars/persian.png", "静态立绘");
  assert.ok(v.sceneTheme.length > 0, "sceneTheme 非空");
  for (const [id, vis] of Object.entries(SPECIES_VISUALS)) {
    assert.ok(typeof vis.staticImage === "string", `${id}.staticImage 字符串`);
    assert.ok(vis.sceneTheme.length > 0, `${id}.sceneTheme 非空`);
  }
});

// ───────────── A2) resolveSpeciesVisual 运行时 ─────────────
test("species-visuals(A2): 注册命中 / 物种头像派生（雪豹≠橘猫）/ 空回退", () => {
  const cat = resolveSpeciesVisual("persian");
  assert.equal(cat.rivePath, RIVE_ASSET_NAME);
  assert.equal(cat.staticImage, "/avatars/persian.png");
  // 未注册但有头像的物种（雪豹）：无 Rive + 自己的立绘——绝不复用橘猫素材
  const leopard = resolveSpeciesVisual("snow_leopard");
  assert.equal(leopard.rivePath, undefined, "雪豹无 Rive 素材");
  assert.equal(leopard.staticImage, "/avatars/snow_leopard.png", "雪豹显示自己的立绘");
  assert.notEqual(leopard.staticImage, cat.staticImage, "雪豹立绘 ≠ 橘猫立绘");
  assert.equal(leopard.sceneTheme, DEFAULT_SCENE_THEME, "未注册物种默认场景主题");
  // 官方宠物 / 未知 / 空：立绘留空由调用方运行时兜底
  for (const id of [null, undefined, "unknown_species"]) {
    const vis = resolveSpeciesVisual(id);
    assert.equal(vis.rivePath, undefined, `${id} 无 Rive`);
    assert.equal(vis.staticImage, "", `${id} 立绘留空`);
    assert.equal(vis.sceneTheme, DEFAULT_SCENE_THEME, `${id} 默认主题`);
  }
});

// ───────────── B1) sm-contract 纯契约模块 ─────────────
test("sm-contract(B1): 5 Trigger 契约 + 别名映射 + inferMood 迁入 + 客户端安全", () => {
  assert.deepEqual([...PET_SM_TRIGGERS], ["pet", "eat", "play", "sleep", "wake"], "契约 Trigger 五值");
  assert.equal(ACTION_TRIGGER_ALIAS.rub, "pet", "蹭蹭 rub = 抚摸 pet（向后兼容）");
  assert.equal(ACTION_TRIGGER_ALIAS.eat, "eat");
  assert.equal(ACTION_TRIGGER_ALIAS.sleep, "sleep");
  assert.equal(inferMood("我想睡觉了"), "sleepy", "inferMood 纯函数在契约模块可用");
  const c = read("src/lib/pets/sm-contract.ts");
  assert.ok(c.includes("PET_MOODS") && c.includes("MOOD_ACTION_MAP"), "枚举/映射单一事实源");
  assert.ok(!c.includes("pets/characters"), "sm-contract 不依赖角色注册表（纯模块）");
  assert.ok(!c.includes("node:fs") && !c.includes("API_KEY"), "零 fs 零密钥（客户端可安全 import）");
});

// ───────────── C1) 解耦红线（prompt 零进客户端 bundle） ─────────────
test("species-visuals(C1): pet-stage/pet-play-config 解耦锁 + characters 视觉字段移除", () => {
  const stage = read("src/components/pet-play/pet-stage.tsx");
  assert.ok(!stage.includes('from "@/lib/pet-play-config"'), "pet-stage 不再 value-import pet-play-config");
  assert.ok(!stage.includes('from "@/lib/pets/characters"'), "pet-stage 不 import characters");
  assert.ok(stage.includes('from "@/lib/pets/sm-contract"'), "动画契约取自 sm-contract（纯模块）");
  assert.ok(stage.includes('from "@/lib/pets/species-visuals"'), "视觉注册表 import");
  // pet-play-config 纯化锁：不得 import characters（否则客户端链再次被 prompt 污染）
  const cfg = read("src/lib/pet-play-config.ts");
  assert.ok(!cfg.includes('from "@/lib/pets/characters"'), "pet-play-config 不得 import characters");
  assert.ok(!cfg.includes("export function fallbackPetReply"), "fallbackPetReply 已迁出（依赖台词库）");
  assert.ok(!cfg.includes("export function inferMood"), "inferMood 已迁至 sm-contract");
  // characters 视觉字段移除（视觉唯一事实源 = species-visuals 注册表）
  const ch = read("src/lib/pets/characters.ts");
  assert.ok(!ch.includes("riveFileKey") && !ch.includes("fallbackImage"), "characters 不再持视觉字段");
  assert.ok(ch.includes("export function fallbackPetReply"), "兜底回复随角色台词库（characters）");
});

// ───────────── D1) 路由接线（按 rivePath 逐路径探测） ─────────────
test("species-visuals(D1): play/movie 视觉走 CMS loader（空表回退注册表）+ 逐路径探测（非全局布尔）", () => {
  for (const name of ["play", "movie"]) {
    const src = read(`src/app/api/pet/${name}/route.ts`);
    assert.ok(src.includes('from "@/lib/cms/loaders"'), `${name} 引入 CMS loaders（2026-10-18 ui-wiring）`);
    assert.ok(src.includes("await getSpeciesVisualById("), `${name} 视觉经 loader（空表回退 resolveSpeciesVisual 注册表）`);
    assert.ok(src.includes("speciesId,"), `${name} pet 对象下发 speciesId`);
    assert.ok(
      src.includes("visual.rivePath ? isRiveAssetAvailable(visual.rivePath) : false"),
      `${name} 按 rivePath 逐路径探测（某物种素材缺席不波及其他物种）`,
    );
    assert.ok(!src.includes("isRiveAssetAvailable(RIVE_ASSET_NAME)"), `${name} 不再硬编码单一资产名`);
  }
});

// ───────────── E1) pet-stage 注册表驱动 ─────────────
test("species-visuals(E1): rivePath 按需拉取 + 立绘/场景换皮 + 场景主题样式注册", () => {
  const stage = read("src/components/pet-play/pet-stage.tsx");
  assert.ok(stage.includes("visualOverride ?? resolveSpeciesVisual(speciesId)"), "CMS 视觉覆写优先，注册表兜底（任务四）");
  assert.ok(stage.includes("/api/pet/asset?name=${visual.rivePath}"), "按注册表 rivePath 拉取（禁硬编码）");
  assert.ok(!stage.includes("RIVE_ASSET_NAME"), "不再硬编码资产名");
  assert.ok(stage.includes("visual.staticImage || avatar"), "立绘：注册表优先，运行时头像兜底");
  assert.ok(stage.includes("pet-scene-${visual.sceneTheme}"), "场景主题类消费");
  assert.ok(stage.includes("if (!visual.rivePath)"), "无素材物种零请求直降");
  const css = read("src/app/globals.css");
  for (const theme of ["pet-scene-meadow", "pet-scene-workshop"]) {
    assert.ok(css.includes(`.${theme}`), `globals.css 含 .${theme}`);
  }
});

// ───────────── B2) README 契约 v2 文档锁 ─────────────
test("sm-contract(B2): README 契约 v2——emotion 0-6 / intensity 0-1 / 5 Trigger / 回 idle / .riv", () => {
  const md = read("assets/rive/README.md");
  assert.ok(md.includes("PetStateMachine"), "状态机名固定");
  assert.ok(md.includes("0-6"), "emotion 取值 0-6（7 情绪索引）");
  assert.ok(md.includes("0-1"), "intensity 取值 0-1");
  for (const t of PET_SM_TRIGGERS) {
    assert.ok(md.includes(`\`${t}\``), `Trigger ${t} 文档化`);
  }
  assert.ok(md.includes("自动回到 `idle`"), "播完自动回 idle 必备过渡");
  assert.ok(md.includes("大小写严格"), "输入名大小写严格警示");
  assert.ok(md.includes("`.riv`") && md.includes("`.rev`"), ".riv（非 .rev）扩展名规范");
  assert.ok(md.includes("species-visuals"), "换皮注册表指引（新增物种只加一条）");
  assert.ok(md.includes("sm-contract.ts"), "契约常量出处指向 sm-contract");
});
