/**
 * 契约测试 · AI 宠物互动页（/pets/my/[id]/play，SCHEMA_VERSION 23）
 *
 *  A) DB：drizzle/0038 + 手动副本 + client.ts v23 + schema.ts（4 表映射锁定）；
 *  B) 配置库 pet-play-config：白名单 / 商品目录 / 人设 prompt / parsePlayResponse /
 *     fallbackPlayReply 运行时行为；
 *  C) API：/api/pet/chat（服务端化红线：鉴权/限流/审核/积分事务/LLM 降级/契约 JSON）、
 *     /api/pet/asset（.riv 鉴权流式下发）、/api/pet/play|buy|use（聚合与道具事务）；
 *  D) 前端：6 区块布局类名 / Rive 双模 / 打字机 / 防调试 / 零密钥锁；
 *  E) 防抄袭：next.config 混淆 + .riv 不在 public/ + 登录默认直达互动页。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PLAY_ACTIONS,
  PLAY_CHAT_COST,
  PLAY_EMOTIONS,
  PLAY_ITEMS,
  RIVE_ASSET_NAME,
  RIVE_STATE_MACHINE,
  buildWorkerCatPrompt,
  fallbackPlayReply,
  inferEmotion,
  parsePlayResponse,
} from "../src/lib/pet-play-config.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ───────────── A1) 迁移档案与手动副本 ─────────────
test("pet-play(A1): drizzle/0038 + 手动副本——DDL 幂等 + 需求 4 表映射注释", () => {
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
  // 需求 4 表映射必须在档案头注说明（pets→adoptions / items→代码常量 / user_backpack→user_items / chat_logs→pet_play_logs）
  const archive = read("drizzle/0038_pet_play.sql");
  for (const marker of ["adoptions", "user_items", "pet_play_logs", "pet-play-config"]) {
    assert.ok(archive.includes(marker), `映射注释含 ${marker}`);
  }
});

// ───────────── A2) client.ts v23 ─────────────
test("pet-play(A2): client.ts SCHEMA_VERSION=23 + hunger_level/pet_play_logs DDL 入 SCHEMA_CREATES", () => {
  const c = read("src/db/client.ts");
  assert.match(c, /const SCHEMA_VERSION = 23;/, "SCHEMA_VERSION bumped to 23");
  assert.ok(c.includes('ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "hunger_level"'), "hunger_level DDL");
  assert.ok(c.includes('CREATE TABLE IF NOT EXISTS "pet_play_logs"'), "pet_play_logs DDL");
  assert.ok(c.includes("idx_pet_play_logs_user"), "索引 1");
  assert.ok(c.includes("idx_pet_play_logs_adoption"), "索引 2");
});

// ───────────── A3) schema.ts ─────────────
test("pet-play(A3): schema.ts adoptions.hungerLevel + petPlayLogs 导出", () => {
  const s = read("src/db/schema.ts");
  assert.ok(s.includes("hungerLevel: integer('hunger_level').notNull().default(50)"), "adoptions.hungerLevel");
  assert.ok(/export const petPlayLogs = pgTable\('pet_play_logs'/.test(s), "petPlayLogs 表");
  for (const f of ["userInput", "petReply", "emotion", "action", "adoptionId"]) {
    assert.ok(s.includes(f), `petPlayLogs.${f}`);
  }
});

// ───────────── B1) 配置库静态契约 ─────────────
test("pet-play(B1): 白名单/商品目录/Rive 契约常量", () => {
  assert.deepEqual([...PLAY_EMOTIONS], ["idle", "happy", "sad", "angry", "eating", "thinking"], "需求 1.2 六情绪标签");
  assert.ok(PLAY_ACTIONS.includes("sleep") && PLAY_ACTIONS.includes("eat"), "动作含 sleep/eat");
  assert.ok(PLAY_ITEMS.length >= 5, "商品 ≥5 件");
  for (const i of PLAY_ITEMS) {
    assert.ok(i.key && i.nameZh && i.nameEn && i.emoji, `${i.key} 基础字段`);
    assert.ok(i.price > 0, `${i.key} 价格 > 0`);
    assert.ok(i.hungerDelta > 0 || i.happinessDelta > 0, `${i.key} 至少一种数值效果`);
  }
  assert.ok(PLAY_ITEMS.some((i) => i.hungerDelta > 0), "含食品（饥饿度）");
  assert.ok(PLAY_ITEMS.some((i) => i.hungerDelta === 0 && i.happinessDelta > 0), "含玩具（心情）");
  assert.equal(RIVE_ASSET_NAME, "worker-cat");
  assert.equal(RIVE_STATE_MACHINE, "PetStateMachine");
  assert.ok(PLAY_CHAT_COST >= 1, "每句对话积分成本 ≥1");
});

// ───────────── B2) parsePlayResponse 运行时 ─────────────
test("pet-play(B2): parsePlayResponse——合法/包裹/越界/垃圾输入", () => {
  const good = parsePlayResponse('{"reply":"喵","emotion":"happy","action":"wave"}');
  assert.deepEqual(good, { reply: "喵", emotion: "happy", action: "wave" });
  const wrapped = parsePlayResponse('好的```json\n{"reply":"摸鱼中","emotion":"idle","action":"sleep"}\n```完毕');
  assert.equal(wrapped?.reply, "摸鱼中");
  assert.equal(wrapped?.action, "sleep");
  const invalid = parsePlayResponse('{"reply":"x","emotion":"dance","action":"fly"}');
  assert.deepEqual(invalid, { reply: "x", emotion: "idle", action: "idle" }, "越界标签归一 idle");
  assert.equal(parsePlayResponse("这不是 JSON"), null);
  assert.equal(parsePlayResponse('{"emotion":"happy"}'), null, "缺 reply 拒绝");
  assert.equal(parsePlayResponse(""), null);
});

// ───────────── B3) 人设 prompt + 兜底 ─────────────
test("pet-play(B3): buildWorkerCatPrompt 打工橘猫人设 + JSON 契约注入", () => {
  const p = buildWorkerCatPrompt({ petName: "阿橘", happiness: 60, hungerLevel: 15 });
  for (const kw of ["打工橘猫", "嘴硬", "摸鱼", "喵了个咪", "本喵", "reply", "emotion", "action", "eating", "thinking"]) {
    assert.ok(p.includes(kw), `人设 prompt 含 ${kw}`);
  }
  assert.ok(p.includes("饿"), "饥饿状态注入");
  assert.ok(p.includes('"happy|sad|angry|eating|thinking"') || p.includes("idle|happy|sad|angry|eating|thinking"), "emotion 值域注入");
});

test("pet-play(B4): fallbackPlayReply/inferEmotion——双语、白名单、关键词情绪", () => {
  for (const locale of ["zh", "en"]) {
    const r = fallbackPlayReply("我想吃小鱼干", locale);
    assert.ok(r.reply.length > 0, `${locale} 兜底有文案`);
    assert.ok(PLAY_EMOTIONS.includes(r.emotion), `${locale} emotion 白名单`);
    assert.ok(PLAY_ACTIONS.includes(r.action), `${locale} action 白名单`);
  }
  assert.deepEqual(inferEmotion("好想吃罐头"), { emotion: "eating", action: "eat" });
  assert.equal(inferEmotion("我想睡觉了").action, "sleep");
  assert.equal(inferEmotion("你是笨蛋").emotion, "angry");
  assert.equal(inferEmotion("hello there").action, "wave");
});

// ───────────── C1) /api/pet/chat 服务端化红线 ─────────────
test("pet-play(C1): /api/pet/chat——鉴权/限流/审核/归属/积分事务/LLM 降级/契约 JSON", () => {
  const src = read("src/app/api/pet/chat/route.ts");
  assert.ok(src.includes("getUserFromRequest"), "鉴权");
  assert.ok(src.includes('status: 401'), "401");
  assert.ok(src.includes("checkRateLimit") && src.includes("RATE_LIMITS.petPlay"), "限流");
  assert.ok(src.includes("moderateText(message)"), "输入审核先于扣费/AI");
  assert.ok(src.includes("moderateText(result.reply)"), "输出审核");
  assert.ok(src.includes("petPlayForbidden") && src.includes("pet.userId !== user.id"), "归属校验 403");
  assert.ok(src.includes("FOR UPDATE") && src.includes("BEGIN") && src.includes("ROLLBACK"), "积分事务");
  assert.ok(src.includes("'pet_play'"), "points_log reason");
  assert.ok(src.includes("INSUFFICIENT_POINTS") && src.includes("status: 402"), "积分不足 402");
  assert.ok(src.includes("generateThrottled"), "Phase 8 并发限速+降级链");
  assert.ok(src.includes("buildWorkerCatPrompt"), "打工橘猫人设");
  assert.ok(src.includes("parsePlayResponse") && src.includes("fallbackPlayReply"), "解析+兜底");
  assert.ok(src.includes("pet_play_logs"), "对话流水落库");
  assert.ok(src.includes("hunger_level"), "饥饿度推进");
  // 统一契约三字段永远在
  assert.ok(/reply: result\.reply,\s*emotion: result\.emotion,\s*action: result\.action,/.test(src), "reply/emotion/action 契约");
  // 密钥零暴露：路由不得直读任何 provider 密钥（密钥只经 llm-fallback/get-model 服务端读取）
  for (const secret of ["DEEPSEEK_API_KEY", "OPENAI_API_KEY", "BAILIAN_API_KEY", "process.env.DEEPSEEK", "apiKey"]) {
    assert.ok(!src.includes(secret), `路由零密钥字样 ${secret}`);
  }
});

// ───────────── C2) /api/pet/asset 安全下发 ─────────────
test("pet-play(C2): /api/pet/asset——鉴权+限流+白名单+防遍历+流式+private 缓存", () => {
  const src = read("src/app/api/pet/asset/route.ts");
  assert.ok(src.includes("getUserFromRequest") && src.includes("status: 401"), "401 鉴权");
  assert.ok(src.includes("checkRateLimit") && src.includes("RATE_LIMITS.petAsset"), "限流");
  assert.ok(src.includes("/^[a-z0-9][a-z0-9-]{0,39}$/"), "资产名白名单");
  assert.ok(src.includes('path.resolve(process.cwd(), "assets", "rive")'), "私有资产目录（非 public）");
  assert.ok(src.includes("startsWith(RIVE_DIR + path.sep)"), "目录遍历二次校验");
  assert.ok(src.includes("createReadStream") && src.includes("Readable.toWeb"), "后端流式输出");
  assert.ok(src.includes("private, max-age=3600"), "私有短缓存防盗链");
  assert.ok(src.includes("status: 404"), "404（前端降级信号）");
  assert.ok(src.includes("nosniff"), "X-Content-Type-Options");
});

// ───────────── C3) .riv 绝不进 public/ ─────────────
test("pet-play(C3): public/ 目录零 .riv 文件（防直链盗用）", () => {
  const walk = (dir) =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(String(e.parentPath ?? e.path), e.name));
  const rivs = walk(join(ROOT, "public")).filter((f) => f.endsWith(".riv"));
  assert.deepEqual(rivs, [], "public/ 不得存在 .riv");
  // 资产 README 约定存在
  assert.ok(existsSync(join(ROOT, "assets/rive/README.md")), "assets/rive/README.md");
});


// ───────────── C4) play 聚合 + buy/use 道具事务 ─────────────
test("pet-play(C4): /api/pet/play 聚合 + buy/use 事务化道具经济", () => {
  const play = read("src/app/api/pet/play/route.ts");
  assert.ok(play.includes("getUserFromRequest") && play.includes("petPlayForbidden"), "鉴权+归属");
  assert.ok(play.includes("SELECT points FROM users"), "积分余额");
  assert.ok(play.includes("source = $2") && play.includes("PLAY_ITEM_SOURCE"), "背包 source 聚合");
  assert.ok(play.includes("PLAY_ITEMS"), "商品目录下发（前端零配置）");
  assert.ok(play.includes("speciesAvatarFor"), "物种头像派生");

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
});

// ───────────── D1) 页面与 6 区块布局类名锁（需求 3） ─────────────
test("pet-play(D1): page.tsx SSR 壳 + 6 区块 Tailwind 布局严格锁定", () => {
  const page = read("src/app/[locale]/pets/my/[id]/play/page.tsx");
  assert.ok(page.includes("PetPlayClient"), "客户端组件");
  assert.ok(page.includes("robots: { index: false }"), "noindex 私有页");

  const c = read("src/components/pet-play/pet-play-client.tsx");
  // Stage
  assert.ok(c.includes("relative h-screen w-full overflow-hidden bg-[#121212] select-none"), "Stage #121212 全屏 select-none");
  // Navbar
  assert.ok(c.includes("absolute top-0 left-0 w-full z-20"), "Navbar 定位");
  // PetContainer
  assert.ok(c.includes("absolute inset-0 flex items-center justify-center z-10"), "PetContainer 居中");
  // Subtitle（bottom-[120px] + 居中 + text-lg + z-20 + text-shadow）
  assert.ok(c.includes("absolute bottom-[120px] left-0 w-full text-center text-white text-lg z-20"), "Subtitle 定位");
  assert.ok(c.includes("textShadow:"), "Subtitle text-shadow");
  // Sidebar（top-[20%] right-0 w-[80px] h-[60%] bg-black/40 backdrop-blur-md z-30 + 滑出/收起）
  assert.ok(c.includes("absolute top-[20%] right-0 w-[80px] h-[60%] bg-black/40 backdrop-blur-md z-30"), "Sidebar 定位");
  assert.ok(c.includes("translate-x-full") && c.includes("translate-x-0"), "Sidebar 滑出/收起双态");
  // 右缘 20px 热区
  assert.ok(c.includes("absolute top-0 right-0 h-full w-[20px]"), "右缘 20px 热区");
  assert.ok(c.includes("onMouseEnter={() => setSidebarOpen(true)}"), "热区悬停滑出");
  // ChatInput
  assert.ok(c.includes("absolute bottom-[30px] left-1/2 -translate-x-1/2 w-[60%] max-w-[800px] z-20"), "ChatInput 定位");
  // 交互
  assert.ok(c.includes('"/api/pet/chat"') && c.includes('"/api/pet/play/buy"') && c.includes('"/api/pet/play/use"'), "三 API 接线");
  assert.ok(c.includes("useTypewriter"), "打字机");
});

// ───────────── D2) Rive 双模 + hooks + 前端零密钥锁 ─────────────
test("pet-play(D2): PetStage Rive/降级双模 + hooks + 前端零密钥/零逻辑", () => {
  const stage = read("src/components/pet-play/pet-stage.tsx");
  assert.ok(stage.includes("@rive-app/react-canvas") && stage.includes("useRive"), "Rive React 运行时");
  assert.ok(stage.includes("stateMachines: RIVE_STATE_MACHINE"), "状态机绑定");
  assert.ok(stage.includes("stateMachineInputs") && stage.includes(".fire()"), "输入同步+Trigger 触发");
  assert.ok(stage.includes("/api/pet/asset") && stage.includes("Authorization"), "鉴权资产通道");
  assert.ok(stage.includes("arrayBuffer"), "ArrayBuffer 喂 Rive（免 ObjectURL 泄漏面）");
  assert.ok(stage.includes("LivingPet"), "降级 CSS 动画立绘");

  const tw = read("src/components/pet-play/use-typewriter.ts");
  assert.ok(tw.includes("setInterval") && tw.includes("clearInterval"), "打字机逐字+清理");

  const ad = read("src/components/pet-play/use-anti-debug.ts");
  assert.ok(ad.includes('process.env.NODE_ENV !== "production"'), "仅生产启用");
  assert.ok(ad.includes("outerWidth") && ad.includes("innerWidth"), "DevTools 尺寸差检测");

  // 前端零密钥/零大模型调用锁（防抄袭核心断言）
  for (const f of ["pet-play-client.tsx", "pet-stage.tsx", "use-typewriter.ts", "use-anti-debug.ts"]) {
    const src = read(`src/components/pet-play/${f}`);
    for (const forbidden of ["API_KEY", "DEEPSEEK", "OPENAI", "BAILIAN", "api.deepseek", "volces", "dashscope", "buildWorkerCatPrompt"]) {
      assert.ok(!src.includes(forbidden), `${f} 不得含 ${forbidden}`);
    }
  }
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
  assert.ok(login.includes('router.push(redirect)'), "显式 redirect 仍优先");
  const panel = read("src/components/pets/companion-panel.tsx");
  assert.ok(panel.includes("`/pets/my/${pet.id}/play`"), "卡片 🎮 互动入口");
  assert.ok(panel.includes('t("playMode")'), "入口 i18n");
});

// ───────────── E3) i18n 双语 parity ─────────────
test("pet-play(E3): petPlay 命名空间双语 parity + api 新 key + playMode", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  const zk = Object.keys(zh.petPlay ?? {}).sort();
  const ek = Object.keys(en.petPlay ?? {}).sort();
  assert.deepEqual(zk, ek, "petPlay keys 双语一致");
  assert.ok(zk.length >= 15, "petPlay 文案 ≥15 条");
  for (const k of ["insufficientPoints", "petPlayForbidden", "petPlayMessageInvalid", "petPlayItemUnknown", "petPlayItemEmpty", "petPlayAssetNotFound", "petPlayFailed"]) {
    assert.ok(zh.api[k] && en.api[k], `api.${k} 双语`);
  }
  assert.ok(zh.myPets.playMode && en.myPets.playMode, "myPets.playMode 双语");
});

// ───────────── E4) 依赖与限流规则注册 ─────────────
test("pet-play(E4): package.json 依赖 + rate-limit 新规则", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies["@rive-app/react-canvas"], "Rive React 运行时依赖");
  assert.ok(pkg.devDependencies["webpack-obfuscator"], "混淆插件 devDependency");
  const rl = read("src/lib/rate-limit.ts");
  assert.ok(rl.includes("petPlay: { limit: 30, windowSec: 60 }"), "对话限流 30/min");
  assert.ok(rl.includes("petAsset: { limit: 30, windowSec: 60 }"), "资产限流 30/min");
});
