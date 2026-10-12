// 宠物剧场（/pet-movie）契约测试：
// 布局契约（需求一）/ API 契约（需求二 {text,mood,action}）/ 表映射零迁移（需求三）/
// 安全红线（需求四：Referer 校验、防右键 F12、混淆、零密钥）/ i18n parity / 纯函数单测。
// 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/pet-movie.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MOVIE_ACTIONS,
  MOVIE_INTERACTIONS,
  MOVIE_MOODS,
  MOVIE_PET_TYPE,
  buildMovieCatPrompt,
  fallbackMovieReply,
  inferMovieMood,
  movieActionToAction,
  movieDefaultPetName,
  movieInteractionByKind,
  movieMoodToEmotion,
  parseMovieResponse,
} from "../src/lib/pet-play-config.ts";
import { speciesAvatarFor } from "../src/lib/species-avatars.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ───────────── 1) 页面路由（/[locale]/pet-movie，middleware 补前缀） ─────────────
test("pet-movie(1): 页面壳存在——PetMovieClient 引用 + noindex + setRequestLocale", () => {
  const p = "src/app/[locale]/pet-movie/page.tsx";
  assert.ok(existsSync(join(ROOT, p)), "page.tsx exists");
  const c = read(p);
  assert.ok(c.includes('from "@/components/pet-movie/pet-movie-client"'), "client import");
  assert.ok(c.includes("PetMovieClient"), "client rendered");
  assert.ok(c.includes('namespace: "petMovie"'), "i18n namespace");
  assert.ok(/robots:\s*\{\s*index:\s*false\s*\}/.test(c), "noindex 私有页");
  assert.ok(c.includes("setRequestLocale(locale)"), "next-intl 静态化");
});

// ───────────── 2) 布局契约（需求一.2 六区块） ─────────────
test("pet-movie(2): Stage 六区块类名契约——深色舞台/字幕/5%热区/侧栏/输入框", () => {
  const c = read("src/components/pet-movie/pet-movie-client.tsx");
  for (const needle of [
    "bg-[#121212]", // 全局深色电影背景
    "select-none", // 禁止选中
    "overflow-hidden", // 隐藏滚动
    "bottom-[120px]", // Subtitle 位于输入框上方
    "textShadow", // 电影字幕可读性
    'aria-live="polite"', // 字幕可访问性
    "w-[5%]", // 右缘 5% 热区（需求原文）
    "top-[20%]", // 侧栏垂直位置
    "w-[80px]", // 侧栏宽度
    "h-[60%]", // 侧栏高度
    "translate-x-full", // 默认收隐蔽于屏外
    "bottom-[30px]", // ChatInput 底部固定
    "w-[60%]", // 输入框宽度
    "max-w-[800px]",
    "onMouseEnter", // 悬停滑出
    "useTypewriter", // 打字机字幕
  ]) {
    assert.ok(c.includes(needle), `client missing: ${needle}`);
  }
});

// ───────────── 3) 客户端安全接线 + 零密钥红线（需求四） ─────────────
test("pet-movie(3): 客户端挂防调试/防拷贝，业务全走服务端 API，零密钥零 prompt", () => {
  const c = read("src/components/pet-movie/pet-movie-client.tsx");
  assert.ok(c.includes("useAntiDebug("), "DevTools 检测挂载");
  assert.ok(c.includes("useAntiCopy("), "防右键/F12 挂载");
  assert.ok(c.includes('mode: "movie"'), "chat 剧场契约");
  assert.ok(c.includes('"/api/pet/movie"'), "初始化聚合 API");
  assert.ok(c.includes('"/api/pet/feed"'), "侧栏互动 API");
  assert.ok(c.includes('"/api/pet/chat"'), "对话 API");
  for (const banned of ["DEEPSEEK", "buildMovieCatPrompt", "buildWorkerCatPrompt", "apiKey", "API_KEY"]) {
    assert.ok(!c.includes(banned), `客户端不得出现: ${banned}`);
  }
});

// ───────────── 4) /api/pet/chat 剧场契约（需求二.1：{text, mood, action}） ─────────────
test("pet-movie(4): chat 路由 movie 模式契约 + 默认模式向后兼容", () => {
  const c = read("src/app/api/pet/chat/route.ts");
  for (const needle of [
    'body.mode === "movie"',
    "buildMovieCatPrompt",
    "parseMovieResponse",
    "fallbackMovieReply",
    "movieMoodToEmotion",
    "movieActionToAction",
    "text: movieReply.text",
    "mood: movieReply.mood",
    "action: movieReply.action",
  ]) {
    assert.ok(c.includes(needle), `chat route missing: ${needle}`);
  }
  // 默认模式契约原样保留（/pets/my/[id]/play 零影响）
  for (const keep of ["reply: result.reply", "emotion: result.emotion", "parsePlayResponse", "buildWorkerCatPrompt"]) {
    assert.ok(c.includes(keep), `默认契约被破坏: ${keep}`);
  }
});

// ───────────── 5) /api/pet/feed 事务扣费（需求二.3） ─────────────
test("pet-movie(5): feed 路由——鉴权/限流/事务扣积分/饥饿度 clamp/402", () => {
  const c = read("src/app/api/pet/feed/route.ts");
  for (const needle of [
    "getUserFromRequest",
    "pet-feed:",
    "RATE_LIMITS.petFeed",
    "movieInteractionByKind",
    "FOR UPDATE",
    "pet_movie_feed",
    "LEAST(100, GREATEST(0, hunger_level",
    "last_interacted_at",
    "INSUFFICIENT_POINTS",
    "BEGIN",
    "COMMIT",
    "ROLLBACK",
  ]) {
    assert.ok(c.includes(needle), `feed route missing: ${needle}`);
  }
});


// ───────────── 6) /api/pet/movie 初始化聚合（自动创建打工橘猫） ─────────────
test("pet-movie(6): movie 路由——最早 adoption / 无则自动建猫 / 互动配置下发", () => {
  const c = read("src/app/api/pet/movie/route.ts");
  for (const needle of [
    "getUserFromRequest",
    "INSERT INTO adoptions",
    "MOVIE_PET_TYPE",
    "movieDefaultPetName",
    "adoptedAt",
    "interactions:",
    "MOVIE_INTERACTIONS",
    "hungerLevel",
    "speciesAvatarFor",
  ]) {
    assert.ok(c.includes(needle), `movie route missing: ${needle}`);
  }
});

// ───────────── 7) /api/pet/asset Referer 校验（需求四.2） ─────────────
test("pet-movie(7): asset 路由——跨站 Referer/Origin 403 + 既有防线保留", () => {
  const c = read("src/app/api/pet/asset/route.ts");
  for (const needle of [
    'req.headers.get("referer")',
    'req.headers.get("origin")',
    "petAssetForbidden",
    "status: 403",
    "getUserFromRequest", // JWT 401
    "RATE_LIMITS.petAsset", // 限流 429
    "NAME_RE", // 文件名白名单
    "createReadStream", // 后端流式
    "nosniff",
  ]) {
    assert.ok(c.includes(needle), `asset route missing: ${needle}`);
  }
});

// ───────────── 8) use-anti-copy（需求四.1：反 F12 + 防右键） ─────────────
test("pet-movie(8): use-anti-copy——contextmenu/F12/DevTools 快捷键，仅生产生效", () => {
  const c = read("src/components/pet-play/use-anti-copy.ts");
  for (const needle of [
    "contextmenu",
    "F12",
    "preventDefault",
    'process.env.NODE_ENV !== "production"',
    "keydown",
    "shiftKey",
    '"U"',
    '"S"',
    '"I"',
  ]) {
    assert.ok(c.includes(needle), `use-anti-copy missing: ${needle}`);
  }
});

// ───────────── 9) next.config 生产混淆（需求四.1 复核） ─────────────
test("pet-movie(9): next.config.ts webpack-obfuscator 生产客户端混淆在位", () => {
  const c = read("next.config.ts");
  assert.ok(c.includes("webpack-obfuscator"), "obfuscator 插件");
  assert.ok(c.includes("!dev && !isServer"), "仅生产客户端");
});

// ───────────── 10) 契约值域 + 互动配置 + 默认宠物 ─────────────
test("pet-movie(10): MOVIE_MOODS/ACTIONS 值域精确，互动配置经济参数，默认猫有头像", () => {
  assert.deepEqual([...MOVIE_MOODS], ["bored", "happy", "sad", "hungry"], "mood 值域（需求二.1）");
  assert.deepEqual([...MOVIE_ACTIONS], ["idle", "eat", "jump"], "action 值域（需求二.1）");
  const food = movieInteractionByKind("food");
  const toy = movieInteractionByKind("toy");
  assert.ok(food && toy, "猫粮/玩具两件");
  assert.ok(food.cost > 0 && toy.cost > 0, "扣余额（价格为正）");
  assert.ok(food.hungerDelta > 0, "猫粮恢复饥饿度");
  assert.ok(toy.happinessDelta > 0, "玩具提升心情");
  assert.equal(movieInteractionByKind("nuclear"), undefined, "未知 kind 拒绝");
  assert.equal(MOVIE_INTERACTIONS.length, 2, "侧栏两按钮");
  // 默认打工橘猫：图鉴猫科物种（官方 PetType 无 cat），头像必须存在
  assert.equal(MOVIE_PET_TYPE, "species:persian");
  assert.ok(speciesAvatarFor("persian"), "persian 手绘头像存在");
  assert.equal(movieDefaultPetName("zh"), "阿橘");
  assert.equal(movieDefaultPetName("en"), "OJ");
});

// ───────────── 11) mood/action → 内部枚举映射（落库 + Rive 驱动） ─────────────
test("pet-movie(11): movieMoodToEmotion / movieActionToAction 映射表全值", () => {
  assert.equal(movieMoodToEmotion("bored"), "idle");
  assert.equal(movieMoodToEmotion("happy"), "happy");
  assert.equal(movieMoodToEmotion("sad"), "sad");
  assert.equal(movieMoodToEmotion("hungry"), "eating");
  assert.equal(movieActionToAction("idle"), "idle");
  assert.equal(movieActionToAction("eat"), "eat");
  assert.equal(movieActionToAction("jump"), "happy");
});

// ───────────── 12) parseMovieResponse 容错（白名单归一） ─────────────
test("pet-movie(12): parseMovieResponse——合法解析/代码块容错/越界归一/缺 text 拒绝", () => {
  const ok = parseMovieResponse('{"text":"喵","mood":"happy","action":"jump"}');
  assert.deepEqual(ok, { text: "喵", mood: "happy", action: "jump" });
  const wrapped = parseMovieResponse('```json\n{"text":"hi","mood":"sad","action":"idle"}\n```');
  assert.equal(wrapped?.mood, "sad", "代码块包裹容错");
  const wild = parseMovieResponse('{"text":"x","mood":"furious","action":"fly"}');
  assert.equal(wild?.mood, "bored", "mood 越界归一 bored");
  assert.equal(wild?.action, "idle", "action 越界归一 idle");
  assert.equal(parseMovieResponse('{"mood":"happy"}'), null, "缺 text 拒绝");
  assert.equal(parseMovieResponse("not json at all"), null, "非 JSON 拒绝");
  assert.equal(parseMovieResponse(""), null, "空串拒绝");
});

// ───────────── 13) buildMovieCatPrompt 人设四要素 + 值域注入 ─────────────
test("pet-movie(13): System Prompt——嘴硬/摸鱼/毒舌/渴望涨薪 + 契约值域注入", () => {
  const p = buildMovieCatPrompt({ petName: "阿橘", happiness: 50, hungerLevel: 50 });
  for (const needle of ["阿橘", "嘴硬", "摸鱼", "毒舌", "涨薪", "bored|happy|sad|hungry", "idle|eat|jump", '{"text"']) {
    assert.ok(p.includes(needle), `prompt missing: ${needle}`);
  }
});

// ───────────── 14) fallbackMovieReply / inferMovieMood（AI 全挂兜底） ─────────────
test("pet-movie(14): 本地兜底——双语非空 + 值域合法 + 关键词推断", () => {
  for (const locale of ["zh", "en"]) {
    const r = fallbackMovieReply("hello", locale);
    assert.ok(r.text.length > 0, `${locale} 兜底文案非空`);
    assert.ok(MOVIE_MOODS.includes(r.mood), "mood 值域合法");
    assert.ok(MOVIE_ACTIONS.includes(r.action), "action 值域合法");
  }
  assert.deepEqual(inferMovieMood("我饿了，有吃的吗"), { mood: "hungry", action: "eat" });
  assert.deepEqual(inferMovieMood("you are great!"), { mood: "happy", action: "jump" });
  assert.deepEqual(inferMovieMood("好难过"), { mood: "sad", action: "idle" });
  assert.deepEqual(inferMovieMood("随便聊聊"), { mood: "bored", action: "idle" });
});


// ───────────── 15) i18n parity（petMovie 命名空间 + nav + api 错误键） ─────────────
test("pet-movie(15): petMovie 双语键集合一致 + nav/api 新键双语存在", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  assert.ok(zh.petMovie && en.petMovie, "petMovie 命名空间双语存在");
  assert.deepEqual(
    Object.keys(zh.petMovie).sort(),
    Object.keys(en.petMovie).sort(),
    "petMovie zh/en 键集合 parity",
  );
  assert.ok(zh.nav.navPetMovie && en.nav.navPetMovie, "nav.navPetMovie 双语");
  for (const k of ["petMovieKindInvalid", "petAssetForbidden"]) {
    assert.ok(zh.api[k], `zh.api.${k}`);
    assert.ok(en.api[k], `en.api.${k}`);
  }
  // 侧栏按钮名与默认宠物名必需键
  for (const k of ["feed", "toy", "greeting", "feedReply", "playReply", "inputPlaceholder"]) {
    assert.ok(zh.petMovie[k] && en.petMovie[k], `petMovie.${k} 双语`);
  }
});

// ───────────── 16) 导航入口（SiteHeader moreItems） ─────────────
test("pet-movie(16): 导航 moreItems 收纳 /pet-movie 入口（绑定 navPetMovie i18n）", () => {
  const h = read("src/components/layout/SiteHeader.tsx");
  const line = h.split(/\r?\n/).find((l) => l.includes('"/pet-movie"'));
  assert.ok(line, "/pet-movie 入口存在");
  assert.ok(line.includes('t("navPetMovie")'), "入口绑定 navPetMovie i18n");
  assert.ok(h.indexOf('"/pet-movie"') > h.indexOf("const moreItems = ["), "收纳进「更多」（不占主入口）");
});

// ───────────── 17) 安全红线：零迁移 + public 无 .riv + 需求 pets 表不撞名 ─────────────
test("pet-movie(17): SCHEMA_VERSION 稳定 23（零迁移）+ public/ 无 .riv + 表映射落点", () => {
  assert.match(read("src/db/client.ts"), /SCHEMA_VERSION\s*=\s*23/, "SCHEMA_VERSION 保持 23（零 schema 变更）");
  const walk = (dir) => {
    const out = [];
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
    return out;
  };
  assert.ok(
    walk(join(ROOT, "public")).every((f) => !f.endsWith(".riv")),
    "public/ 下不得出现 .riv（唯一出口 /api/pet/asset）",
  );
  // 需求「pets 表」与既有灵魂卡 pets 表撞名 → 落点 adoptions / pet_play_logs（文档钉死）
  const schema = read("src/db/schema.ts");
  assert.ok(schema.includes("pgTable('adoptions'"), "adoptions 表（pets 落点）");
  assert.ok(schema.includes("hunger_level"), "adoptions.hunger_level（饥饿度）");
  assert.ok(schema.includes("pgTable('pet_play_logs'"), "pet_play_logs 表（pet_interactions 落点）");
});

// ───────────── 18) 集成文档（需求五） ─────────────
test("pet-movie(18): pet-movie-integration.md 存在且覆盖路由/表/API/Rive/安全五章", () => {
  const p = join(ROOT, "pet-movie-integration.md");
  assert.ok(existsSync(p), "文档存在于项目根目录");
  const d = readFileSync(p, "utf8");
  for (const needle of [
    "/pet-movie",
    "pet_play_logs", // pet_interactions 落点
    "adoptions", // pets 落点
    "SCHEMA_VERSION", // 零迁移说明
    "/api/pet/chat",
    "/api/pet/feed",
    "/api/pet/movie",
    "/api/pet/asset",
    "PetStateMachine", // Rive 状态机命名规范
    "Referer", // 资产防盗链
    "webpack-obfuscator", // 代码混淆位置
    "use-anti-copy", // 防右键/F12
    "use-anti-debug",
    "bored|happy|sad|hungry", // 契约值域
    "idle|eat|jump",
  ]) {
    assert.ok(d.includes(needle), `文档缺失: ${needle}`);
  }
});
