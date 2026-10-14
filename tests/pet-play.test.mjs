/**
 * 契约测试 · AI 宠物互动页（/pets/my/[id]/play，SCHEMA_VERSION 24，Phase 12 框架性修复演进）
 *
 *  A) DB：drizzle/0038（基线）+ 0039（v24 可观测性 4 列）+ client.ts v24 + schema.ts；
 *  B) 契约层 pet-play-config：统一枚举 re-export / 商品目录 / parsePetChatResponse /
 *     fallbackPetReply / 新经济常量（免费次数/日上限/离线衰减/饥饿阈值）；
 *  C) API：/api/pet/chat（双维限流/日上限/免费计数/退款/观测日志/统一契约）、
 *     /api/pet/asset（.riv 鉴权流式下发 + 上架探测零请求直降）、/api/pet/play|buy|use（聚合/事务/交互记录）；
 *  D) 前端：沉浸布局 / Rive 双模 + intensity / 背包双形态 / 402 弹窗 / 埋点 / 音效 / 零密钥锁；
 *  E) 防抄袭：next.config 混淆 + .riv 不在 public/ + 登录默认直达互动页。
 *  （角色注册表专项 → pet-characters.test.mjs；剧场页 → pet-movie.test.mjs）
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HUNGER_DECAY_PER_HOUR,
  HUNGER_SETTLE_SQL,
  HUNGRY_THRESHOLD,
  PET_ACTIONS,
  PET_CHAT_DAILY_CAP,
  PET_CHAT_FREE_DAILY,
  PET_CHAT_MAX_LEN,
  PET_MOODS,
  PLAY_CHAT_COST,
  PLAY_ITEMS,
  RIVE_ASSET_NAME,
  RIVE_STATE_MACHINE,
  fallbackPetReply,
  inferMood,
  parsePetChatResponse,
} from "../src/lib/pet-play-config.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ───────────── A1) 迁移档案（0038 基线 + 0039 可观测性） ─────────────
test("pet-play(A1): drizzle/0038 基线 + drizzle/0039 观测列——DDL 幂等 + 映射注释", () => {
  for (const f of ["drizzle/0038_pet_play.sql", "scripts/migrate-pet-play-tables.sql"]) {
    assert.ok(existsSync(join(ROOT, f)), `${f} exists`);
    const sql = read(f);
    assert.match(sql, /ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "hunger_level" integer DEFAULT 50 NOT NULL/, "hunger_level 幂等补列");
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS "pet_play_logs"'), "pet_play_logs 建表");
    for (const col of ["user_id", "adoption_id", "user_input", "pet_reply", "emotion", "action", "created_at"]) {
      assert.ok(sql.includes(`"${col}"`), `pet_play_logs.${col}`);
    }
    assert.ok(sql.includes("idx_pet_play_logs_user"), "user 索引");
    assert.ok(sql.includes("idx_pet_play_logs_adoption"), "adoption 索引");
  }
  const v24 = read("drizzle/0039_pet_chat_observability.sql");
  for (const col of ["kind", "source", "duration_ms", "tokens_used"]) {
    assert.ok(v24.includes(`ADD COLUMN IF NOT EXISTS "${col}"`), `0039 含 ${col} 幂等补列`);
  }
  const archive = read("drizzle/0038_pet_play.sql");
  for (const marker of ["adoptions", "user_items", "pet_play_logs", "pet-play-config"]) {
    assert.ok(archive.includes(marker), `映射注释含 ${marker}`);
  }
});

// ───────────── A2) client.ts v24 ─────────────
test("pet-play(A2): client.ts SCHEMA_VERSION=24 + v23/v24 DDL 均入同步清单", () => {
  const c = read("src/db/client.ts");
  assert.match(c, /const SCHEMA_VERSION = 24;/, "SCHEMA_VERSION bumped to 24");
  assert.ok(c.includes('ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "hunger_level"'), "hunger_level DDL");
  assert.ok(c.includes('CREATE TABLE IF NOT EXISTS "pet_play_logs"'), "pet_play_logs DDL");
  for (const col of ["kind", "source", "duration_ms", "tokens_used"]) {
    assert.ok(c.includes(`ADD COLUMN IF NOT EXISTS "${col}"`), `client.ts v24 含 ${col}`);
  }
});

// ───────────── A3) schema.ts ─────────────
test("pet-play(A3): schema.ts petPlayLogs 基线列 + v24 观测列", () => {
  const s = read("src/db/schema.ts");
  assert.ok(s.includes("hungerLevel: integer('hunger_level').notNull().default(50)"), "adoptions.hungerLevel");
  assert.ok(/export const petPlayLogs = pgTable\('pet_play_logs'/.test(s), "petPlayLogs 表");
  for (const f of ["userInput", "petReply", "emotion", "action", "adoptionId", "kind", "source", "durationMs", "tokensUsed"]) {
    assert.ok(s.includes(f), `petPlayLogs.${f}`);
  }
});

// ───────────── B1) 统一契约常量与新经济参数 ─────────────
test("pet-play(B1): 统一枚举 re-export / 商品目录 / Rive 契约 / 新经济常量", () => {
  assert.deepEqual([...PET_MOODS], ["idle", "happy", "sad", "angry", "hungry", "thinking", "sleepy"], "七情绪统一枚举");
  assert.ok(PET_ACTIONS.includes("rub") && PET_ACTIONS.includes("eat") && PET_ACTIONS.includes("sleep"), "动作含 rub/eat/sleep");
  assert.ok(PLAY_ITEMS.length >= 5, "商品 ≥5 件（猫粮/罐头/大餐/猫薄荷/逗猫棒）");
  for (const i of PLAY_ITEMS) {
    assert.ok(i.key && i.nameZh && i.nameEn && i.emoji, `${i.key} 基础字段`);
    assert.ok(i.price > 0, `${i.key} 价格 > 0`);
    assert.ok(i.hungerDelta > 0 || i.happinessDelta > 0, `${i.key} 至少一种数值效果`);
    assert.ok(i.effect === "eat" || i.effect === "play", `${i.key} 效果类型`);
  }
  // 需求四.1 三类必备道具：猫粮 / 罐头 / 逗猫棒
  assert.ok(PLAY_ITEMS.some((i) => i.key === "snack_fish" && i.effect === "eat"), "猫粮类");
  assert.ok(PLAY_ITEMS.some((i) => i.key === "can_premium"), "罐头类");
  assert.ok(PLAY_ITEMS.some((i) => i.key === "feather_wand" && i.effect === "play"), "逗猫棒");
  assert.equal(RIVE_ASSET_NAME, "worker-cat");
  assert.equal(RIVE_STATE_MACHINE, "PetStateMachine");
  assert.ok(PLAY_CHAT_COST >= 1, "每句对话积分成本 ≥1");
  // 新经济常量（需求五.3 / 六.2 / 四.4）
  assert.equal(PET_CHAT_FREE_DAILY, 5, "每日免费 5 次");
  assert.equal(PET_CHAT_DAILY_CAP, 100, "每日总上限 100");
  assert.equal(PET_CHAT_MAX_LEN, 500, "单条 500 字");
  assert.equal(HUNGER_DECAY_PER_HOUR, 2, "离线衰减每小时 -2");
  assert.equal(HUNGRY_THRESHOLD, 20, "饥饿阈值 20");
  assert.ok(HUNGER_SETTLE_SQL.includes("3600") && HUNGER_SETTLE_SQL.includes("GREATEST(0"), "离线结算 SQL 按小时下限 0");
});

// ───────────── B2) parsePetChatResponse 运行时（统一 { text, mood, intensity } 契约） ─────────────
test("pet-play(B2): parsePetChatResponse——合法/包裹/越界 mood 归一/intensity 钳制", () => {
  const good = parsePetChatResponse('{"text":"喵","mood":"happy","intensity":2}');
  assert.deepEqual(good, { text: "喵", mood: "happy", intensity: 2, action: "happy" });
  const wrapped = parsePetChatResponse('好的```json\n{"text":"摸鱼中","mood":"sleepy","intensity":1}\n```完毕');
  assert.equal(wrapped?.text, "摸鱼中");
  assert.equal(wrapped?.mood, "sleepy");
  assert.equal(wrapped?.action, "sleep", "动作由映射表推导");
  const invalid = parsePetChatResponse('{"text":"x","mood":"dance","intensity":9}');
  assert.deepEqual(invalid, { text: "x", mood: "idle", intensity: 2, action: "idle" }, "越界 mood 归一 idle + intensity 钳 2");
  const noIntensity = parsePetChatResponse('{"text":"y","mood":"hungry"}');
  assert.equal(noIntensity?.intensity, 1, "intensity 缺省 1");
  assert.equal(noIntensity?.action, "eat", "hungry→eat 推导");
  assert.equal(parsePetChatResponse("这不是 JSON"), null);
  assert.equal(parsePetChatResponse('{"mood":"happy"}'), null, "缺 text 拒绝");
  assert.equal(parsePetChatResponse(""), null);
});

// ───────────── B3) inferMood / fallbackPetReply 运行时 ─────────────
test("pet-play(B3): inferMood 关键词推断 + fallbackPetReply 台词随角色", () => {
  assert.equal(inferMood("好想吃罐头"), "hungry");
  assert.equal(inferMood("我想睡觉了"), "sleepy");
  assert.equal(inferMood("你是笨蛋"), "angry");
  assert.equal(inferMood("为什么会这样"), "thinking");
  assert.equal(inferMood("你好棒"), "happy");
  assert.equal(inferMood("嗯"), "idle");
  for (const locale of ["zh", "en"]) {
    const r = fallbackPetReply("我想吃小鱼干", locale, "species:persian");
    assert.ok(r.text.length > 0, `${locale} 兜底有文案`);
    assert.ok(PET_MOODS.includes(r.mood), `${locale} mood 白名单`);
    assert.ok(PET_ACTIONS.includes(r.action), `${locale} action 白名单`);
    assert.equal(r.intensity, 1, "兜底 intensity=1");
  }
  // 台词随角色（需求一）：橘猫回复含人设梗；雪豹回复零橘猫梗
  const cat = fallbackPetReply("我饿了", "zh", "species:persian");
  assert.ok(/喵|小鱼干|罐头|工位/.test(cat.text), "橘猫兜底含人设梗");
  const leopard = fallbackPetReply("我饿了", "zh", "species:snow_leopard");
  for (const w of ["橘猫", "摸鱼", "工位", "小鱼干", "喵"]) {
    assert.ok(!leopard.text.includes(w), `雪豹兜底不得含「${w}」`);
  }
});

// ───────────── C1) /api/pet/chat 服务端化红线 + Phase 12 计费/风控/观测 ─────────────
test("pet-play(C1): /api/pet/chat——双维限流/免费计数/退款/观测日志/统一契约", () => {
  const src = read("src/app/api/pet/chat/route.ts");
  assert.ok(src.includes("getUserFromRequest"), "鉴权");
  assert.ok(src.includes("status: 401"), "401");
  assert.ok(src.includes("checkRateLimit") && src.includes("RATE_LIMITS.petPlay"), "用户维限流");
  assert.ok(src.includes("RATE_LIMITS.petChatIp") && src.includes("x-forwarded-for"), "IP 维限流（需求六.1）");
  assert.ok(src.includes("moderateText(message)"), "输入审核先于扣费/AI");
  assert.ok(src.includes("moderateText(result.text)"), "输出审核");
  assert.ok(src.includes("petPlayForbidden") && src.includes("pet.userId !== user.id"), "归属校验 403");
  assert.ok(src.includes("HUNGER_SETTLE_SQL"), "离线饥饿结算（需求四.4）");
  assert.ok(src.includes("PET_CHAT_DAILY_CAP") && src.includes('code: "DAILY_CAP"'), "每日上限 429（需求六.2）");
  assert.ok(src.includes("PET_CHAT_FREE_DAILY") && src.includes("kind = 'chat'"), "免费计数口径（需求五.3）");
  assert.ok(src.includes("FOR UPDATE") && src.includes("BEGIN") && src.includes("ROLLBACK"), "积分事务");
  assert.ok(src.includes("INSUFFICIENT_POINTS") && src.includes("status: 402"), "积分不足 402");
  assert.ok(src.includes("pet_play_refund") && src.includes("chat_refund"), "AI 失败退款 + 不占次数（需求五.2）");
  assert.ok(src.includes("generateThrottled"), "Phase 8 并发限速+降级链");
  assert.ok(src.includes("resolveCharacter"), "角色注册表人设（需求一）");
  assert.ok(src.includes("parsePetChatResponse") && src.includes("fallbackPetReply"), "解析+兜底");
  assert.ok(src.includes("duration_ms") && src.includes("tokens_used"), "观测列落库（需求六.3）");
  assert.ok(src.includes("hunger_level"), "饥饿度推进");
  for (const field of ["text: result.text", "mood: result.mood", "intensity: result.intensity", "action: result.action", "freeRemaining", "hungry"]) {
    assert.ok(src.includes(field), `统一契约响应含 ${field}`);
  }
});

// ───────────── C2) /api/pet/asset 安全下发 ─────────────
test("pet-play(C2): /api/pet/asset——鉴权+限流+白名单+防遍历+流式+private 缓存+Referer", () => {
  const src = read("src/app/api/pet/asset/route.ts");
  assert.ok(src.includes("getUserFromRequest") && src.includes("status: 401"), "401 鉴权");
  assert.ok(src.includes("checkRateLimit") && src.includes("RATE_LIMITS.petAsset"), "限流");
  assert.ok(src.includes("NAME_RE"), "文件名白名单");
  assert.ok(src.includes("startsWith(RIVE_DIR"), "目录前缀二次校验（防遍历）");
  assert.ok(src.includes("createReadStream"), "流式输出");
  assert.ok(src.includes("private, max-age=3600"), "私有短缓存防盗链（需求二.3）");
  assert.ok(src.includes("status: 404"), "404（前端降级信号）");
  assert.ok(src.includes("nosniff"), "X-Content-Type-Options");
  assert.ok(src.includes('req.headers.get("referer")'), "Referer 跨站校验（需求二.3）");
});

// ───────────── C3) .riv 绝不进 public/ ─────────────
test("pet-play(C3): public/ 目录零 .riv 文件（防直链盗用）", () => {
  const walk = (dir) =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(String(e.parentPath ?? e.path), e.name));
  const rivs = walk(join(ROOT, "public")).filter((f) => f.endsWith(".riv"));
  assert.deepEqual(rivs, [], "public/ 不得存在 .riv");
  assert.ok(existsSync(join(ROOT, "assets/rive/README.md")), "assets/rive/README.md");
});

// ───────────── C4) play 聚合 + buy/use 道具事务 + 交互记录 ─────────────
test("pet-play(C4): /api/pet/play 聚合（角色/饥饿结算）+ buy/use 事务 + use 写交互记录", () => {
  const play = read("src/app/api/pet/play/route.ts");
  assert.ok(play.includes("getUserFromRequest") && play.includes("petPlayForbidden"), "鉴权+归属");
  assert.ok(play.includes("SELECT points FROM users"), "积分余额");
  assert.ok(play.includes("source = $2") && play.includes("PLAY_ITEM_SOURCE"), "背包 source 聚合");
  assert.ok(play.includes("PLAY_ITEMS"), "商品目录下发（前端零配置）");
  assert.ok(play.includes("speciesAvatarFor"), "物种头像派生");
  assert.ok(play.includes("characterView") && play.includes("resolveCharacter"), "角色展示层下发（需求一）");
  assert.ok(play.includes("HUNGER_SETTLE_SQL") && play.includes("HUNGRY_THRESHOLD"), "离线结算 + 饥饿标志（需求四.4）");

  const buy = read("src/app/api/pet/play/buy/route.ts");
  assert.ok(buy.includes("FOR UPDATE") && buy.includes("status: 402"), "余额行锁+402");
  assert.ok(buy.includes("'pet_play_buy'"), "points_log reason");
  assert.ok(buy.includes("INSERT INTO user_items") && buy.includes("PLAY_ITEM_SOURCE"), "道具入库");
  assert.ok(buy.includes("playItemByKey"), "目录校验");

  const use = read("src/app/api/pet/play/use/route.ts");
  assert.ok(use.includes("ORDER BY created_at ASC LIMIT 1 FOR UPDATE"), "FIFO 锁取消耗");
  assert.ok(use.includes("status: 409") && use.includes("ITEM_EMPTY"), "无库存 409");
  assert.ok(use.includes("DELETE FROM user_items"), "消耗删除");
  assert.ok(use.includes("LEAST(100, GREATEST(0, hunger_level + $2))"), "饥饿度 clamp");
  assert.ok(use.includes("petPlayForbidden"), "使用归属校验");
  assert.ok(use.includes("HUNGER_SETTLE_SQL"), "先结算离线衰减再叠加道具（需求四.4）");
  assert.ok(use.includes("INSERT INTO pet_play_logs") && use.includes("'item'"), "交互记录 kind='item'（需求四.3）");
  assert.ok(use.includes("resolveCharacter") && use.includes("linesZh"), "台词随角色下发（需求一）");
});

// ───────────── C5) Rive 上架探测（服务端 existsSync + 聚合下发 + 部署文件追踪） ─────────────
test("pet-play(C5): rive-asset-server 探测模块 + play/movie 下发 riveAvailable + 部署追踪", () => {
  // 服务端探测模块（node:fs 专用，客户端禁引）：未上架 → 前端零请求直降，无 404 噪音
  const probe = read("src/lib/pets/rive-asset-server.ts");
  assert.ok(probe.includes("existsSync"), "existsSync 探测");
  assert.ok(probe.includes('path.resolve(process.cwd(), "assets", "rive")'), "私有资产目录（与 asset 路由同约定）");
  assert.ok(probe.includes("availabilityCache"), "实例级缓存（免每请求 hit 磁盘）");
  assert.ok(probe.includes("isRiveAssetAvailable"), "探测函数导出");

  // play/movie 聚合响应下发 riveAvailable
  for (const [name, src] of [
    ["play", read("src/app/api/pet/play/route.ts")],
    ["movie", read("src/app/api/pet/movie/route.ts")],
  ]) {
    assert.ok(src.includes('from "@/lib/pets/rive-asset-server"'), `${name} 引入探测模块`);
    assert.ok(
      src.includes("riveAvailable: isRiveAssetAvailable(RIVE_ASSET_NAME)"),
      `${name} 聚合响应下发 riveAvailable`,
    );
  }

  // 部署红线：.riv 为运行时 fs 读取（非静态 import），必须显式纳入 serverless 文件追踪，
  // 否则美术交付后生产 existsSync 仍恒 false / asset 路由 404（「放入即自动切换」失效）。
  const cfg = read("next.config.ts");
  assert.ok(cfg.includes("outputFileTracingIncludes"), "next.config 部署追踪声明");
  assert.ok(cfg.includes("assets/rive"), "追踪覆盖 assets/rive");
});

// ───────────── D1) 页面与沉浸布局 + 交互接线锁 ─────────────
test("pet-play(D1): page.tsx SSR 壳 + 沉浸布局 + 背包/弹窗/埋点/音效/空状态接线", () => {
  const page = read("src/app/[locale]/pets/my/[id]/play/page.tsx");
  assert.ok(page.includes("PetPlayClient"), "客户端组件");
  assert.ok(page.includes("robots: { index: false }"), "noindex 私有页");

  const c = read("src/components/pet-play/pet-play-client.tsx");
  // 沉浸舞台（全屏深色 select-none）
  assert.ok(c.includes("h-dvh") && c.includes("bg-[#121212]") && c.includes("select-none"), "Stage 沉浸全屏");
  // 字幕（打字机 + text-shadow）
  assert.ok(c.includes("absolute bottom-[120px]") && c.includes("textShadow:"), "Subtitle 定位+阴影");
  assert.ok(c.includes("useTypewriter"), "打字机");
  // 桌面热区 + 移动 FAB + 背包组件
  assert.ok(c.includes("onMouseEnter={() => setSidebarOpen(true)}"), "桌面 hover 热区");
  assert.ok(c.includes("🎒") && c.includes("md:hidden"), "移动端 🎒 浮动按钮（需求四.2）");
  assert.ok(c.includes("PetBackpack"), "背包组件");
  // 三 API 接线
  for (const api of ['"/api/pet/chat"', '"/api/pet/play/buy"', '"/api/pet/play/use"']) {
    assert.ok(c.includes(api), `接线 ${api}`);
  }
  // 统一契约渲染（需求三.3）
  for (const f of ["data.text", "data.mood", "data.action", "data.intensity"]) {
    assert.ok(c.includes(f), `契约渲染 ${f}`);
  }
  // 402 充值弹窗（需求五.1）+ 免费次数徽章 + 饥饿提示
  assert.ok(c.includes("InsufficientPointsModal") && c.includes("rechargeOpen"), "402 弹窗");
  assert.ok(c.includes("freeToday"), "免费次数显示");
  assert.ok(c.includes("hungryHint"), "饥饿提示");
  // 空状态领养引导（需求七.3）
  assert.ok(c.includes("no-pet") && c.includes("adoptCta") && c.includes("/pets/adopt"), "未领养引导");
  // 工具条：静音 + 退出沉浸（需求七.2）
  assert.ok(c.includes("toggleMute") && c.includes("exitImmersive"), "静音/退出沉浸");
  // Rive 上架探测接线（未上架零请求直降，无 404 噪音）
  assert.ok(c.includes("riveAvailable={riveAvailable}") && c.includes("data.riveAvailable === true"), "PetStage 上架探测接线");
  // 埋点五事件（需求八）
  for (const ev of ["pet_page_view", "pet_chat_send", "pet_feed_click", "pet_item_buy", "pet_page_exit"]) {
    assert.ok(c.includes(ev) || read("src/lib/pet-track.ts").includes(ev), `埋点 ${ev}`);
  }
  assert.ok(c.includes("trackPetExitOnce"), "退出埋点挂载");
  // 音效（需求七.2）
  assert.ok(c.includes("playPetSound"), "互动音效");
});

// ───────────── D2) Rive 双模 + 背包双形态 + 前端零密钥锁 ─────────────
test("pet-play(D2): pet-stage Rive 状态机/intensity/失败上报 + 背包双形态 + 零密钥", () => {
  const stage = read("src/components/pet-play/pet-stage.tsx");
  assert.ok(stage.includes("@rive-app/react-canvas") && stage.includes("useRive"), "Rive React 运行时（需求三.1）");
  assert.ok(stage.includes("stateMachines: RIVE_STATE_MACHINE"), "状态机绑定");
  assert.ok(stage.includes("stateMachineInputs") && stage.includes(".fire()"), "输入同步+Trigger 触发");
  assert.ok(stage.includes('"intensity"'), "intensity Number 输入（需求三.3）");
  assert.ok(stage.includes("/api/pet/asset") && stage.includes("Authorization"), "鉴权资产通道");
  assert.ok(stage.includes("arrayBuffer"), "ArrayBuffer 喂 Rive（免 ObjectURL 泄漏面）");
  assert.ok(stage.includes("LivingPet"), "降级 CSS 动画立绘");
  assert.ok(stage.includes("console.error") && stage.includes("onAssetFailed"), "资源失败不静默（需求二.2）");
  assert.ok(stage.includes('"rub"'), "蹭蹭 rub Trigger（需求三.2）");
  // 上架探测短路（2026-10-17 收尾）：false 零请求直降；info 级透明信息而非 error
  assert.ok(stage.includes("if (!riveAvailable)") && stage.includes("console.info"), "未上架零请求直降（无 404 噪音）");

  const bag = read("src/components/pet-play/pet-backpack.tsx");
  assert.ok(bag.includes("md:block") && bag.includes("md:hidden"), "桌面侧栏/移动抽屉双形态（需求四.2）");
  assert.ok(bag.includes("onMouseLeave={onClose}"), "桌面移出收回");
  assert.ok(bag.includes("translate-y-full") && bag.includes("translate-y-0"), "抽屉滑出/收起双态");
  assert.ok(bag.includes("useItem") && bag.includes("buy"), "持有→使用 / 无持有→购买");

  const tw = read("src/components/pet-play/use-typewriter.ts");
  assert.ok(tw.includes("setInterval") && tw.includes("clearInterval"), "打字机逐字+清理");

  const ad = read("src/components/pet-play/use-anti-debug.ts");
  assert.ok(ad.includes('process.env.NODE_ENV !== "production"'), "仅生产启用");

  // 前端零密钥/零大模型调用锁（防抄袭核心断言）
  for (const f of [
    "pet-play-client.tsx", "pet-stage.tsx", "pet-backpack.tsx",
    "insufficient-points-modal.tsx", "use-typewriter.ts", "use-anti-debug.ts",
  ]) {
    const src = read(`src/components/pet-play/${f}`);
    for (const forbidden of ["API_KEY", "DEEPSEEK", "OPENAI", "BAILIAN", "api.deepseek", "volces", "dashscope", "buildSystemPrompt"]) {
      assert.ok(!src.includes(forbidden), `${f} 不得含 ${forbidden}`);
    }
  }
});

// ───────────── D3) 沉浸式：layout 隐藏主站 chrome（需求七.1） ─────────────
test("pet-play(D3): layout.tsx 对宠物页隐藏 SiteHeader/Footer（x-pathname 判定）", () => {
  const lay = read("src/app/[locale]/layout.tsx");
  assert.ok(lay.includes("isPetImmersive"), "沉浸判定变量");
  assert.ok(lay.includes("x-pathname"), "middleware 路径头");
  assert.ok(lay.includes("/pet-movie") && lay.includes("/play"), "两沉浸路径覆盖");
  assert.ok(/isPetImmersive\s*\?\s*\(/.test(lay), "条件渲染分支");
});

// ───────────── E1) 防抄袭：构建混淆配置 ─────────────
test("pet-play(E1): next.config.ts 生产客户端代码混淆", () => {
  const c = read("next.config.ts");
  assert.ok(c.includes("webpack-obfuscator"), "webpack-obfuscator 插件");
  assert.ok(c.includes("!dev && !isServer"), "仅生产客户端生效");
  assert.ok(c.includes("rotateStringArray") && c.includes("base64"), "字符串加密");
  assert.ok(c.includes("obfuscation skipped"), "依赖缺失不阻断构建");
});

// ───────────── E2) 登录默认直达互动页 + 入口接线 ─────────────
test("pet-play(E2): 登录后默认进互动页 + 我的灵宠卡 🎮 入口", () => {
  const login = read("src/app/[locale]/login/page.tsx");
  assert.ok(login.includes("`/pets/my/${firstId}/play`"), "无 redirect 时直达 play");
  assert.ok(login.includes("router.push(redirect)"), "显式 redirect 仍优先");
  const panel = read("src/components/pets/companion-panel.tsx");
  assert.ok(panel.includes("`/pets/my/${pet.id}/play`"), "卡片 🎮 互动入口");
  assert.ok(panel.includes('t("playMode")'), "入口 i18n");
});

// ───────────── E3) i18n 双语 parity ─────────────
test("pet-play(E3): petPlay 命名空间双语 parity + api 新 key", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  const zk = Object.keys(zh.petPlay ?? {}).sort();
  const ek = Object.keys(en.petPlay ?? {}).sort();
  assert.deepEqual(zk, ek, "petPlay keys 双语一致");
  assert.ok(zk.length >= 25, "petPlay 文案 ≥25 条（含沉浸/背包/弹窗新 key）");
  // 占位符参数化（需求一.2：含 {name} 不含「打工橘猫」硬编码）
  assert.ok(zh.petPlay.inputPlaceholder.includes("{name}"), "占位符 {name} 参数化");
  assert.ok(!zh.petPlay.inputPlaceholder.includes("打工橘猫"), "占位符无橘猫硬编码");
  for (const k of ["backpack", "buy", "useItem", "owned", "freeToday", "hungryHint", "assetFallback", "rechargeTitle", "goRecharge", "goCheckin", "exitImmersive", "soundOn", "soundOff", "adoptEmptyTitle", "adoptCta", "dailyCap"]) {
    assert.ok(zh.petPlay[k] && en.petPlay[k], `petPlay.${k} 双语`);
  }
  for (const k of ["insufficientPoints", "petPlayForbidden", "petPlayMessageInvalid", "petPlayItemUnknown", "petPlayItemEmpty", "petPlayAssetNotFound", "petPlayFailed", "petChatDailyCap"]) {
    assert.ok(zh.api[k] && en.api[k], `api.${k} 双语`);
  }
  assert.ok(zh.myPets.playMode && en.myPets.playMode, "myPets.playMode 双语");
});

// ───────────── E4) 依赖与限流规则注册 ─────────────
test("pet-play(E4): package.json 依赖 + rate-limit 规则（含 IP 维）", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies["@rive-app/react-canvas"], "Rive React 运行时依赖");
  assert.ok(pkg.devDependencies["webpack-obfuscator"], "混淆插件 devDependency");
  const rl = read("src/lib/rate-limit.ts");
  assert.ok(rl.includes("petPlay: { limit: 30, windowSec: 60 }"), "对话限流 30/min");
  assert.ok(rl.includes("petAsset: { limit: 30, windowSec: 60 }"), "资产限流 30/min");
  assert.ok(rl.includes("petChatIp: { limit: 60, windowSec: 60 }"), "IP 维限流 60/min（需求六.1）");
});

// ───────────── E5) 埋点模块双通道 + 音效模块 ─────────────
test("pet-play(E5): pet-track gtag/_hmt 双通道 + pet-sound 静音持久化", () => {
  const tr = read("src/lib/pet-track.ts");
  assert.ok(tr.includes("gtag") && tr.includes("_hmt") && tr.includes("_trackEvent"), "GA+百度双通道");
  assert.ok(tr.includes("visibilitychange") && tr.includes("beforeunload"), "退出双保险");
  const sd = read("src/lib/pet-sound.ts");
  assert.ok(sd.includes("AudioContext") && sd.includes("createOscillator"), "WebAudio 短音");
  assert.ok(sd.includes("aiabw_pet_mute") && sd.includes("isPetMuted") && sd.includes("setPetMuted"), "静音开关持久化");
});
