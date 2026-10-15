/**
 * 契约测试 · 宠物剧场页（/pet-movie，Phase 12 框架性修复演进版）
 *
 * 剧场页与互动页（/pets/my/[id]/play）统一架构：
 *  - 统一契约 { text, mood, intensity }（需求三.3，原 mode="movie" 双契约废除）；
 *  - 侧栏改背包模式（需求四：/api/pet/movie 下发 items，复用 /api/pet/play/buy|use 事务）；
 *  - 角色注册表人设（需求一：打工橘猫仅 persian，其余物种走艾比灵宠）；
 *  - /api/pet/feed 保留 legacy 兼容（直购互动，老客户端可用）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MOVIE_INTERACTIONS,
  MOVIE_PET_TYPE,
  movieDefaultPetName,
  movieInteractionByKind,
} from "../src/lib/pet-play-config.ts";
import { speciesAvatarFor } from "../src/lib/species-avatars.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ───────────── 1) /api/pet/movie 初始化聚合（角色/背包/饥饿结算下发） ─────────────
test("pet-movie(1): movie 路由——最早 adoption / 无则自动建猫 / 角色+背包+饥饿标志下发", () => {
  const c = read("src/app/api/pet/movie/route.ts");
  assert.ok(c.includes("getUserFromRequest") && c.includes("status: 401"), "鉴权 401");
  assert.ok(c.includes("checkRateLimit"), "限流");
  assert.ok(c.includes("orderBy(asc(adoptions.adoptedAt))"), "最早一只 adoption 为主角");
  assert.ok(c.includes("MOVIE_PET_TYPE") && c.includes("movieDefaultPetName"), "无宠物自动创建打工橘猫");
  assert.ok(c.includes("characterView") && c.includes("resolveCharacter"), "角色展示层下发（需求一）");
  assert.ok(c.includes("PLAY_ITEMS") && c.includes("PLAY_ITEM_SOURCE"), "背包商品目录下发（需求四）");
  assert.ok(c.includes("HUNGER_SETTLE_SQL") && c.includes("HUNGRY_THRESHOLD"), "离线结算 + 饥饿标志");
  assert.ok(c.includes("MOVIE_INTERACTIONS"), "legacy interactions 保留下发");
  assert.ok(c.includes("visual.rivePath ? isRiveAssetAvailable(visual.rivePath) : false"), "Rive 上架探测按物种 rivePath 下发（未上架零请求直降）");
});

// ───────────── 2) 统一契约：chat 路由无剧场双契约残留 ─────────────
test("pet-movie(2): /api/pet/chat 统一 { text, mood, intensity, intent } 契约（mode 双契约废除）", () => {
  const c = read("src/app/api/pet/chat/route.ts");
  for (const f of ["text: result.text", "mood: result.mood", "intensity: result.intensity", "intent: resolution.intent"]) {
    assert.ok(c.includes(f), `统一契约含 ${f}`);
  }
  // 旧剧场双契约符号已清除
  for (const gone of ["movieReply", "parseMovieResponse", "buildMovieCatPrompt", "fallbackMovieReply", "isMovie"]) {
    assert.ok(!c.includes(gone), `chat 路由不得残留 ${gone}`);
  }
});

// ───────────── 3) /api/pet/feed legacy 保留（老客户端兼容） ─────────────
test("pet-movie(3): feed 路由 legacy 保留——鉴权/限流/402/kind 白名单", () => {
  const c = read("src/app/api/pet/feed/route.ts");
  assert.ok(c.includes("getUserFromRequest") && c.includes("status: 401"), "鉴权");
  assert.ok(c.includes("checkRateLimit") && c.includes("RATE_LIMITS.petFeed"), "限流");
  assert.ok(c.includes("movieInteractionByKind"), "kind 白名单校验");
  assert.ok(c.includes("INSUFFICIENT_POINTS") && c.includes("status: 402"), "积分不足 402");
  assert.ok(c.includes("'pet_movie_feed'"), "points_log reason 保留");
  assert.ok(MOVIE_INTERACTIONS.length === 2, "legacy 互动两项");
  assert.equal(movieInteractionByKind("nuclear"), undefined, "未知 kind 拒绝");
});

// ───────────── 4) /api/pet/asset Referer 校验（需求四.2 防线保留） ─────────────
test("pet-movie(4): asset 路由——跨站 Referer/Origin 403 + 既有防线保留", () => {
  const c = read("src/app/api/pet/asset/route.ts");
  for (const needle of [
    'req.headers.get("referer")',
    'req.headers.get("origin")',
    "status: 403",
    "getUserFromRequest",
    "checkRateLimit",
    "createReadStream",
    "private, max-age=3600",
    "nosniff",
  ]) {
    assert.ok(c.includes(needle), `asset route missing: ${needle}`);
  }
});

// ───────────── 5) 剧场客户端：统一契约 + 背包 + 防拷贝 + 埋点 + 沉浸 ─────────────
test("pet-movie(5): movie 客户端——契约渲染/背包模式/防拷贝/埋点/工具条", () => {
  const c = read("src/components/pet-movie/pet-movie-client.tsx");
  for (const f of ["data.text", "data.mood", "data.action", "data.intensity"]) {
    assert.ok(c.includes(f), `契约渲染 ${f}`);
  }
  // 不再发送 mode: "movie"（双契约废除）
  assert.ok(!c.includes('mode: "movie"'), "不再发送 mode=movie");
  // 背包模式（需求四：买/用走 play 事务路由，不再调 /api/pet/feed）
  assert.ok(c.includes("PetBackpack"), "背包组件");
  assert.ok(c.includes('"/api/pet/play/buy"') && c.includes('"/api/pet/play/use"'), "背包事务接线");
  assert.ok(!c.includes('"/api/pet/feed"'), "不再调 legacy feed");
  // 防拷贝 + 防调试（需求四.1 保留）
  assert.ok(c.includes("useAntiCopy") && c.includes("useAntiDebug"), "防拷贝+防调试");
  // 402 弹窗 / 免费次数 / 饥饿提示 / 工具条 / 埋点
  assert.ok(c.includes("InsufficientPointsModal"), "402 充值弹窗");
  assert.ok(c.includes("freeToday") && c.includes("hungryHint"), "免费徽章+饥饿提示");
  assert.ok(c.includes("toggleMute") && c.includes("exitImmersive"), "静音+退出沉浸");
  for (const ev of ["pet_page_view", "pet_chat_send", "pet_feed_click", "pet_item_buy"]) {
    assert.ok(c.includes(ev), `埋点 ${ev}`);
  }
  assert.ok(c.includes('trackPetExitOnce("movie")'), "退出埋点");
  assert.ok(c.includes("handleAssetFailed"), "资源失败轻提示（需求二.2）");
  assert.ok(c.includes("riveAvailable={riveAvailable}") && c.includes("data.riveAvailable === true"), "PetStage 上架探测接线");
  assert.ok(c.includes("h-dvh"), "沉浸全屏");
});

// ───────────── 6) 剧场默认宠物契约 ─────────────
test("pet-movie(6): MOVIE_PET_TYPE=species:persian + 头像存在 + 默认名双语", () => {
  assert.equal(MOVIE_PET_TYPE, "species:persian");
  assert.ok(speciesAvatarFor("persian"), "persian 手绘头像存在");
  assert.equal(movieDefaultPetName("zh"), "阿橘");
  assert.equal(movieDefaultPetName("en"), "OJ");
});

// ───────────── 7) 安全红线：SCHEMA_VERSION 24 + public 无 .riv + 表映射不撞名 ─────────────
test("pet-movie(7): SCHEMA_VERSION 24 + public/ 无 .riv + 表映射落点", () => {
  assert.match(read("src/db/client.ts"), /SCHEMA_VERSION\s*=\s*24/, "SCHEMA_VERSION 24");
  const walk = (dir) =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(String(e.parentPath ?? e.path), e.name));
  assert.ok(
    walk(join(ROOT, "public")).every((f) => !f.endsWith(".riv")),
    "public/ 下不得出现 .riv（唯一出口 /api/pet/asset）",
  );
  // 需求「pets 表」与既有灵魂卡 pets 表撞名 → 落点 adoptions / pet_play_logs（文档钉死）
  const doc = read("pet-movie-integration.md");
  for (const marker of ["adoptions", "user_items", "pet_play_logs", "characters", "mood"]) {
    assert.ok(doc.includes(marker), `文档含 ${marker}`);
  }
});

// ───────────── 8) i18n petMovie 双语 parity ─────────────
test("pet-movie(8): petMovie 命名空间双语 parity + 占位符参数化", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  const zk = Object.keys(zh.petMovie ?? {}).sort();
  const ek = Object.keys(en.petMovie ?? {}).sort();
  assert.deepEqual(zk, ek, "petMovie keys 双语一致");
  assert.ok(zk.length >= 25, "petMovie 文案 ≥25 条");
  assert.ok(zh.petMovie.inputPlaceholder.includes("{name}"), "占位符 {name} 参数化");
  assert.ok(!zh.petMovie.inputPlaceholder.includes("打工橘猫"), "占位符无橘猫硬编码");
  for (const k of ["backpack", "buy", "useItem", "owned", "freeToday", "hungryHint", "assetFallback", "rechargeTitle", "goRecharge", "goCheckin", "exitImmersive", "dailyCap"]) {
    assert.ok(zh.petMovie[k] && en.petMovie[k], `petMovie.${k} 双语`);
  }
});
