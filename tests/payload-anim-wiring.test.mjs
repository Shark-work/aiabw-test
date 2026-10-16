/**
 * 契约测试 · PetAnimations 读取侧接线（任务四：后台改物种视觉/动画映射，舞台即时切换）
 *
 *  A) play/movie 聚合 API 下发 visual（CMS getSpeciesVisualById 数据；
 *     与 riveAvailable 探测同源——isRiveAssetAvailable 串联语义不破）；
 *  B) pet-stage visualOverride 优先 + 注册表兜底（无覆写 = 接入前行为一致）；
 *  C) 双 client 接 visualOverride（state 下发 + PetStage prop）；
 *  D) /api/pet/chat 动作推导走 getPetAnimationMap（全局默认 + 物种覆写），
 *     PET_ACTIONS 白名单校验 + actionForMood 兜底（Rive 输入契约不破）；
 *  E) 本测试已挂载 npm test。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ─────────────────────── A) 双 API 下发 visual ───────────────────────
test("anim-wiring(A): play/movie 下发 visual（与 riveAvailable 探测同源串联）", () => {
  for (const api of ["src/app/api/pet/play/route.ts", "src/app/api/pet/movie/route.ts"]) {
    const r = read(api);
    assert.ok(r.includes("await getSpeciesVisualById(speciesId ?? \"\")"), `${api} CMS 视觉读取`);
    assert.ok(r.includes("visual.rivePath ? isRiveAssetAvailable(visual.rivePath) : false"), `${api} 探测串联`);
    assert.ok(r.includes("      visual,"), `${api} 下发 visual 对象`);
  }
});

// ─────────────────────── B) pet-stage visualOverride ───────────────────────
test("anim-wiring(B): pet-stage CMS 覆写优先 + 注册表兜底", () => {
  const s = read("src/components/pet-play/pet-stage.tsx");
  assert.ok(s.includes('import { resolveSpeciesVisual, type SpeciesVisual } from "@/lib/pets/species-visuals"'), "类型引入");
  assert.ok(s.includes("visualOverride?: SpeciesVisual | null"), "visualOverride prop");
  assert.ok(s.includes("const visual = visualOverride ?? resolveSpeciesVisual(speciesId)"), "覆写优先 + 注册表兜底");
  // 下游消费不变（rivePath 拉取 / 立绘 / 场景主题 / 零请求直降）
  assert.ok(s.includes("/api/pet/asset?name=${visual.rivePath}"), "rivePath 拉取同源");
  assert.ok(s.includes("visual.staticImage || avatar"), "立绘消费同源");
  assert.ok(s.includes("pet-scene-${visual.sceneTheme}"), "场景主题消费同源");
  assert.ok(s.includes("if (!visual.rivePath)"), "无素材零请求直降同源");
});

// ─────────────────────── C) 双 client 接线 ───────────────────────
test("anim-wiring(C): 双 client state 下发 + PetStage prop 消费", () => {
  for (const ui of ["src/components/pet-play/pet-play-client.tsx", "src/components/pet-movie/pet-movie-client.tsx"]) {
    const c = read(ui);
    assert.ok(c.includes('import type { SpeciesVisual } from "@/lib/pets/species-visuals"'), `${ui} 类型引入`);
    assert.ok(c.includes("useState<SpeciesVisual | null>(null)"), `${ui} state（缺省 null 兜底）`);
    assert.ok(c.includes("setVisualOverride(data.visual ?? null)"), `${ui} init 同步`);
    assert.ok(c.includes("visualOverride={visualOverride}"), `${ui} PetStage prop`);
  }
});

// ─────────────────────── D) chat 动作推导 CMS 化 ───────────────────────
test("anim-wiring(D): /api/pet/chat 动作推导走 getPetAnimationMap + 白名单 + 契约兜底", () => {
  const r = read("src/app/api/pet/chat/route.ts");
  assert.ok(r.includes('import { getPetAnimationMap, getTokenRuleByKey } from "@/lib/cms/loaders"'), "引入 loader");
  assert.ok(r.includes("await getPetAnimationMap(speciesIdForAnim)"), "物种覆写映射读取");
  assert.ok(r.includes("isSpeciesPetType(pet.petType) ? speciesIdOf(pet.petType) : null"), "物种 id 解析");
  assert.ok(r.includes("(PET_ACTIONS as readonly string[]).includes(mapped)"), "PET_ACTIONS 白名单校验");
  assert.ok(r.includes(": actionForMood(resolution.emotion)"), "越界/取不到回退代码契约");
  assert.ok(r.includes("action: derivedAction,"), "契约响应用推导结果");
  // loader 侧合并语义（全局默认 + 物种覆写 + 代码契约为底）
  const l = read("src/lib/cms/loaders.ts");
  assert.ok(l.includes("{ ...MOOD_ACTION_MAP }"), "代码契约为底");
  assert.ok(l.includes('"pet-animations",'), "失效 tag pet-animations");
});

// ─────────────────────── E) 挂载 ───────────────────────
test("anim-wiring(E): 本测试已挂载 npm test", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts.test.includes("payload-anim-wiring.test.mjs"), "已挂载 npm test");
});
