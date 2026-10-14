/**
 * 契约测试 · AI 宠物角色注册表（需求一：统一角色数据源；SCHEMA_VERSION 24）
 *
 *  A) 注册表结构：字段齐全 / 台词库 7 情绪 × 双语全覆盖 / 服务端专用红线；
 *  B) resolveCharacter 解析：persian→打工橘猫，其余物种/官方宠物/未知→艾比灵宠
 *     （「显示雪豹但文案是橘猫」错配修复的端到端锁定）；
 *  C) System Prompt：人设要素 + { text, mood, intensity } 契约注入 + **不注入动作名**
 *     （需求三.2：动作由服务端 MOOD_ACTION_MAP 推导，大模型不返回动画名）；
 *  D) 统一枚举与映射表：PET_MOODS 7 值索引序（Rive 契约）+ MOOD_ACTION_MAP 全覆盖。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CHARACTER,
  MOOD_ACTION_MAP,
  PET_ACTIONS,
  PET_CHARACTERS,
  PET_MOODS,
  characterView,
  resolveCharacter,
} from "../src/lib/pets/characters.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ───────────── A1) 注册表结构：字段齐全 ─────────────
test("pet-characters(A1): ≥2 角色且每角色字段齐全", () => {
  assert.ok(PET_CHARACTERS.length >= 2, "至少 打工橘猫 + 艾比灵宠 两角色");
  for (const c of PET_CHARACTERS) {
    for (const f of ["id", "nameZh", "nameEn", "personality", "greetingZh", "greetingEn"]) {
      assert.ok(typeof c[f] === "string" && c[f].length > 0, `${c.id}.${f} 非空`);
    }
    assert.ok(Array.isArray(c.species), `${c.id}.species 数组`);
    assert.equal(typeof c.buildSystemPrompt, "function", `${c.id}.buildSystemPrompt 函数`);
    // 视觉字段已解耦至 species-visuals.ts（换皮层）：角色注册表只管人设/台词/prompt
    assert.ok(!("riveFileKey" in c) && !("fallbackImage" in c), `${c.id} 视觉字段已迁至 species-visuals`);
  }
  // 兜底角色必须在注册表内且为 DEFAULT_CHARACTER
  assert.ok(PET_CHARACTERS.includes(DEFAULT_CHARACTER), "DEFAULT_CHARACTER 在注册表内");
  assert.equal(DEFAULT_CHARACTER.id, "aibi-spirit", "兜底角色 = 艾比灵宠");
});

// ───────────── A2) 台词库：7 情绪 × 双语全覆盖 ─────────────
test("pet-characters(A2): 每角色台词库覆盖全部 7 情绪 × 双语", () => {
  for (const c of PET_CHARACTERS) {
    for (const mood of PET_MOODS) {
      assert.ok(Array.isArray(c.linesZh[mood]) && c.linesZh[mood].length >= 1, `${c.id}.linesZh.${mood} ≥1 条`);
      assert.ok(Array.isArray(c.linesEn[mood]) && c.linesEn[mood].length >= 1, `${c.id}.linesEn.${mood} ≥1 条`);
    }
  }
});

// ───────────── A3) 服务端专用红线：客户端零 characters import ─────────────
test("pet-characters(A3): 前端组件不得 import 角色注册表（prompt/台词零进 bundle）", () => {
  for (const f of [
    "src/components/pet-play/pet-play-client.tsx",
    "src/components/pet-movie/pet-movie-client.tsx",
    "src/components/pet-play/pet-stage.tsx",
    "src/components/pet-play/pet-backpack.tsx",
    "src/components/pet-play/insufficient-points-modal.tsx",
  ]) {
    const src = read(f);
    assert.ok(!src.includes("pets/characters"), `${f} 不得 import characters`);
    for (const forbidden of ["buildSystemPrompt", "linesZh", "greetingZh"]) {
      assert.ok(!src.includes(forbidden), `${f} 不得含 ${forbidden}`);
    }
  }
});

// ───────────── B1) resolveCharacter 解析矩阵 ─────────────
test("pet-characters(B1): persian→打工橘猫；其余物种/官方宠物/未知→艾比灵宠", () => {
  assert.equal(resolveCharacter("species:persian").id, "worker-cat", "剧场默认猫 = 打工橘猫");
  assert.equal(resolveCharacter("species:snow_leopard").id, "aibi-spirit", "雪豹 ≠ 橘猫（错配修复点）");
  assert.equal(resolveCharacter("species:red_fox").id, "aibi-spirit", "其他物种走兜底角色");
  assert.equal(resolveCharacter("fox").id, "aibi-spirit", "官方宠物 fox 走兜底角色");
  assert.equal(resolveCharacter("penguin").id, "aibi-spirit", "官方宠物 penguin 走兜底角色");
  assert.equal(resolveCharacter(null).id, "aibi-spirit", "null 兜底");
  assert.equal(resolveCharacter("").id, "aibi-spirit", "空串兜底");
  assert.equal(resolveCharacter("unknown-type").id, "aibi-spirit", "未知类型兜底");
});

// ───────────── B2) 雪豹错配修复端到端：雪豹 prompt/开场白无橘猫梗 ─────────────
test("pet-characters(B2): 雪豹角色 prompt 与开场白零橘猫文案", () => {
  const c = resolveCharacter("species:snow_leopard");
  const prompt = c.buildSystemPrompt({ petName: "雪宝", speciesLabel: "雪豹", happiness: 60, hungerLevel: 30 });
  assert.ok(prompt.includes("雪宝"), "prompt 含宠物名");
  assert.ok(prompt.includes("雪豹"), "prompt 含物种锚点");
  for (const catWord of ["橘猫", "打工", "摸鱼", "喵了个咪", "小鱼干"]) {
    assert.ok(!prompt.includes(catWord), `雪豹 prompt 不得含「${catWord}」`);
  }
  for (const catWord of ["喵", "橘猫"]) {
    assert.ok(!c.greetingZh.includes(catWord), `雪豹开场白不得含「${catWord}」`);
  }
  // 橘猫角色则必须保留橘猫人设（不误伤）
  const cat = resolveCharacter("species:persian");
  assert.ok(cat.greetingZh.includes("本喵"), "橘猫开场白保留人设");
});

// ───────────── C1) System Prompt 契约：{ text, mood, intensity } + 七情绪值域 ─────────────
test("pet-characters(C1): prompt 注入统一契约与七情绪白名单", () => {
  for (const c of PET_CHARACTERS) {
    const p = c.buildSystemPrompt({ petName: "测试", happiness: 60, hungerLevel: 15 });
    assert.ok(p.includes('"text"'), `${c.id} 契约含 text`);
    assert.ok(p.includes('"mood"'), `${c.id} 契约含 mood`);
    assert.ok(p.includes('"intensity"'), `${c.id} 契约含 intensity`);
    assert.ok(p.includes(PET_MOODS.join("|")), `${c.id} 七情绪值域注入`);
    assert.ok(p.includes("饿"), `${c.id} 饥饿状态注入`);
  }
});

// ───────────── C2) 大模型不返回动作名（需求三.2 红线） ─────────────
test("pet-characters(C2): prompt 契约段不含动作名/动画名注入", () => {
  for (const c of PET_CHARACTERS) {
    const p = c.buildSystemPrompt({ petName: "测试", happiness: 60, hungerLevel: 60 });
    // 输出契约只允许 { text, mood, intensity }——不得出现 "action" 字段契约
    assert.ok(!p.includes('"action"'), `${c.id} 契约不得含 action 字段`);
    // 动作名（rub 动画触发词）不得作为输出指令出现
    assert.ok(!p.includes("rub"), `${c.id} 不得注入 rub 动作`);
  }
});

// ───────────── C3) 人设要素保留（打工橘猫四要素） ─────────────
test("pet-characters(C3): 打工橘猫 prompt 保留嘴硬/摸鱼/口头禅/打工梗", () => {
  const cat = PET_CHARACTERS.find((c) => c.id === "worker-cat");
  const p = cat.buildSystemPrompt({ petName: "阿橘", happiness: 60, hungerLevel: 15 });
  for (const kw of ["打工橘猫", "嘴硬", "摸鱼", "喵了个咪", "本喵", "KPI", "涨薪"]) {
    assert.ok(p.includes(kw), `橘猫 prompt 含「${kw}」`);
  }
});

// ───────────── D1) 统一枚举：PET_MOODS 索引序锁定（Rive Number 输入契约） ─────────────
test("pet-characters(D1): PET_MOODS 七值顺序 + PET_ACTIONS 含 rub", () => {
  assert.deepEqual(
    [...PET_MOODS],
    ["idle", "happy", "sad", "angry", "hungry", "thinking", "sleepy"],
    "情绪索引序（0-6，美术按此绑定）",
  );
  for (const a of ["idle", "eat", "sleep", "think", "wave", "happy", "sad", "angry", "rub"]) {
    assert.ok(PET_ACTIONS.includes(a), `动作含 ${a}`);
  }
  assert.ok(PET_ACTIONS.includes("rub"), "蹭蹭 rub 动作位");
});

// ───────────── D2) MOOD_ACTION_MAP 全覆盖且值合法 ─────────────
test("pet-characters(D2): 情绪→动作映射表全情绪覆盖、值在白名单", () => {
  for (const mood of PET_MOODS) {
    const action = MOOD_ACTION_MAP[mood];
    assert.ok(action, `${mood} 有映射`);
    assert.ok(PET_ACTIONS.includes(action), `${mood}→${action} 合法`);
  }
  assert.equal(MOOD_ACTION_MAP.hungry, "eat", "饥饿→进食");
  assert.equal(MOOD_ACTION_MAP.sleepy, "sleep", "困倦→睡觉");
  assert.equal(MOOD_ACTION_MAP.thinking, "think", "思考→思考");
});

// ───────────── D3) characterView 展示层最小子集 ─────────────
test("pet-characters(D3): characterView 只含 id/displayName/greeting（零 prompt 零台词库）", () => {
  const cat = resolveCharacter("species:persian");
  const zh = characterView(cat, "zh");
  const en = characterView(cat, "en");
  assert.deepEqual(Object.keys(zh).sort(), ["displayName", "greeting", "id"], "字段最小子集");
  assert.equal(zh.id, "worker-cat");
  assert.equal(zh.displayName, "打工橘猫");
  assert.equal(en.displayName, "Worker Cat");
  assert.ok(zh.greeting.length > 0 && en.greeting.length > 0, "开场白双语");
});
