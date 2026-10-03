// Aibi ↔ 聊天（方案 a，2026-10-07）契约测试：
// 覆盖「获得Aibi → 聊天互动 → 留存」完整闭环的各环节源码与纯函数：
//  1) schema：aibi_tokens.thread_id（drizzle schema / client DDL / ALTER / 索引 / 版本闸门 / 迁移脚本幂等）
//  2) prompt：aibi-prompt 纯函数（前缀解析 / personalityTemplate 种子 / 成长状态注入 / PetConfig 构建）
//  3) resolvePetConfig aibi 分支（ugc.ts 联表查询）
//  4) /api/chat 主体分支（凭证归属 + minted 校验；经典线逻辑保留；quota/VIP 记忆共用）
//  5) POST /api/threads（zod / 鉴权 / 404/403/409 / 幂等 + 并发守护 / 事务）
//  6) /chat 页 aibi 反查 + 来源标识（emoji 头像 / 艾比徽章 / aibiWelcome）
//  7) 入口：背包卡片 + 详情页 AibiChatButton（/api/threads → /chat?thread= 跳转）
//  8) 隐私：threadId 仅持有者下放（/chat SSR 消息加载不校验归属，threadId 即窥视钥匙）
//  9) i18n 五 key zh/en 对齐 + supports_chat 全物种恢复 true
// 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/aibi-chat-e2e.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  AIBI_PET_TYPE_PREFIX,
  isAibiPetType,
  aibiTokenIdOf,
  buildAibiSystemPrompt,
  buildAibiPetConfig,
} from "../src/lib/aibi-prompt.ts";
import { AIBI_SPECIES } from "../src/lib/aibi-catalog.ts";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const exists = (rel) => existsSync(join(ROOT, rel));

// ============ 1) schema：thread_id 迁移（幂等） ============
test("schema.ts: aibiTokens.threadId uuid 列 references threads.id", () => {
  const schema = read("src/db/schema.ts");
  assert.ok(schema.includes("threadId: uuid('thread_id').references(() => threads.id)"));
});

test("client.ts: DDL/ALTER/索引/版本闸门四处落地，SCHEMA_VERSION >= 12", () => {
  const client = read("src/db/client.ts");
  assert.ok(
    client.includes('"thread_id" uuid REFERENCES "threads"("id") ON DELETE SET NULL'),
    "aibi_tokens 建表含 thread_id",
  );
  assert.ok(
    client.includes(
      'ALTER TABLE "aibi_tokens" ADD COLUMN IF NOT EXISTS "thread_id" uuid REFERENCES "threads"("id") ON DELETE SET NULL',
    ),
    "SCHEMA_ALTERS 幂等补列",
  );
  assert.ok(client.includes("idx_aibi_tokens_thread_id"), "thread_id 反查索引");
  const v = Number(client.match(/const SCHEMA_VERSION = (\d+);/)?.[1]);
  assert.ok(v >= 12, `SCHEMA_VERSION 需 >=12（实际 ${v}）`);
});

test("drizzle/0029 档案 + 迁移脚本：幂等（IF NOT EXISTS），可安全重复执行", () => {
  const sql = read("drizzle/0029_aibi_chat_thread.sql");
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS "thread_id"'), "drizzle 档案幂等补列");
  assert.ok(sql.includes("ON DELETE SET NULL"), "线程删除时凭证保留");
  const mig = read("scripts/migrate-add-aibi-threadid.mjs");
  assert.ok(mig.includes("ADD COLUMN IF NOT EXISTS"), "迁移脚本幂等补列");
  assert.ok(mig.includes("CREATE INDEX IF NOT EXISTS"), "迁移脚本幂等补索引");
  assert.ok(mig.includes("safe to re-run"), "脚本声明可重复执行");
});
// ============ 2) aibi-prompt 纯函数 ============
test("aibi-prompt: petType 前缀解析（aibi:<aibiTokenId>）", () => {
  assert.equal(AIBI_PET_TYPE_PREFIX, "aibi:");
  assert.ok(isAibiPetType("aibi:AIBI-000001"));
  assert.ok(!isAibiPetType("fox") && !isAibiPetType("species:corgi") && !isAibiPetType(null));
  assert.equal(aibiTokenIdOf("aibi:AIBI-000001"), "AIBI-000001");
});

test("aibi-prompt: SystemPrompt 以 personalityTemplate 为种子 + 注入成长状态/lore", () => {
  const sp = AIBI_SPECIES.find((s) => s.id === "mist-fox");
  const prompt = buildAibiSystemPrompt({
    aibiTokenId: "AIBI-000039",
    species: sp,
    rarityNameEn: "Rare",
    habitatNameEn: "Mistwood",
    personalityType: null, // 回退物种模板
    mood: "开心",
    affinity: 66,
    energy: 30,
    growthLevel: 4,
  });
  assert.ok(prompt.includes("Misttail Fox"), "物种英文名");
  assert.ok(prompt.includes("雾尾狐"), "物种中文名");
  assert.ok(prompt.includes("tsundere"), "personalityTemplate 种子注入");
  assert.ok(prompt.includes("AIBI-000039"), "链上凭证编号");
  assert.ok(prompt.includes('mood="开心"'), "心情注入");
  assert.ok(prompt.includes("affinity=66/100"), "亲密度注入");
  assert.ok(prompt.includes("energy=30/100"), "精力注入");
  assert.ok(prompt.includes("Lv.4"), "成长等级注入");
  assert.ok(prompt.includes("Rare"), "稀有度注入");
  assert.ok(prompt.includes("Mistwood"), "栖息地注入");
  assert.ok(prompt.includes("get_weather(city)"), "工具段（agent 能力）");
  assert.ok(prompt.includes("SAME language"), "回复跟随用户语言");
  const p2 = buildAibiSystemPrompt({
    aibiTokenId: "AIBI-000040",
    species: sp,
    personalityType: "慵懒",
    mood: null,
    affinity: null,
    energy: null,
    growthLevel: null,
  });
  assert.ok(p2.includes("慵懒"), "实例 personalityType 优先于物种模板");
  assert.ok(p2.includes("affinity=0/100") && p2.includes("Lv.1"), "状态缺省兜底");
});

test("aibi-prompt: buildAibiPetConfig 双语名字/emoji/welcome/性格回退", () => {
  const sp = AIBI_SPECIES.find((s) => s.id === "star-cat");
  const subject = {
    aibiTokenId: "AIBI-000001",
    species: sp,
    personalityType: null,
    mood: null,
    affinity: 0,
    energy: 100,
    growthLevel: 1,
  };
  const zh = buildAibiPetConfig(subject, "zh");
  const en = buildAibiPetConfig(subject, "en");
  assert.equal(zh.name, "星灵猫");
  assert.equal(en.name, "Stellar Cat");
  assert.equal(zh.emoji, "🐱", "物种 emoji 立绘");
  assert.equal(zh.avatar, "", "无图片资源，渲染走 emoji");
  assert.ok(zh.systemPrompt.length > 200 && zh.systemPrompt === buildAibiSystemPrompt(subject));
  assert.ok(zh.personality === "傲娇型" && en.personality === "tsundere", "性格回退物种模板");
  assert.ok(zh.welcome.includes("星灵猫") && en.welcome.includes("Stellar Cat"));
  const orphan = buildAibiPetConfig({ ...subject, species: null }, "zh");
  assert.equal(orphan.name, "AIBI-000001", "物种缺失名字回退凭证号");
  assert.equal(orphan.emoji, "✨", "物种缺失 emoji 兜底");
});

// ============ 3) resolvePetConfig aibi 分支 ============
test("ugc.ts: getAibiPetConfig 联表查询 + resolvePetConfig aibi 分支", () => {
  const ugc = read("src/lib/ugc.ts");
  assert.ok(ugc.includes("export async function getAibiPetConfig"), "aibi 配置读取函数");
  assert.ok(ugc.includes("FROM aibi_tokens t"), "凭证表");
  assert.ok(ugc.includes("LEFT JOIN aibi_personalities p"), "性格档案联表");
  assert.ok(ugc.includes("isAibiPetType(petType)"), "resolvePetConfig 前缀分支");
  assert.ok(ugc.includes("buildAibiPetConfig("), "构建 PetConfig");
});

// ============ 4) /api/chat 主体分支 ============
test("chat route: aibi 分支校验（归属 + minted），经典线逻辑完整保留", () => {
  const route = read("src/app/api/chat/route.ts");
  assert.ok(
    route.includes("const aibiTokenId = isAibiPetType(petType) ? aibiTokenIdOf(petType as string) : null;"),
    "petType=aibi: 前缀分支",
  );
  assert.ok(route.includes("AND owner_id = $2::uuid AND status = 'minted'"), "凭证归属 + minted 校验");
  assert.ok(
    route.includes('!aibiTokenId && (typeof adoptionId !== "string" || !adoptionId)'),
    "经典线 adoptionId 强校验保留",
  );
  assert.ok(route.includes("adoption.userId !== user.id"), "经典线所有权绑定保留");
  assert.ok(
    route.includes("if (adoption && adoption.chatCount >= FREE_MESSAGE_LIMIT && !adoption.isUnlocked)"),
    "10 句免费门槛仅经典线",
  );
  assert.ok(
    route.includes("const memoryPetId = aibiTokenId ? (petType as string) : (adoptionId ?? null);"),
    "VIP 记忆 pet 维度键（pet_memories.pet_id 为 text）",
  );
  assert.equal(route.split("petId: memoryPetId").length - 1, 2, "recall/extract 两处注入");
  assert.ok(route.includes("getHardLimitMessage(adoption?.petType, locale)"), "文案 helper 对 aibi 安全");
  assert.ok(route.includes("getSoftWarnMessage(adoption?.petType, locale, remaining)"));
// ============ 5) POST /api/threads ============
test("threads API: 鉴权/404/403/409 + 幂等 + 并发守护 + 事务", () => {
  assert.ok(exists("src/app/api/threads/route.ts"), "路由存在（新建，不删任何现有路由）");
  const src = read("src/app/api/threads/route.ts");
  assert.ok(src.includes('export const runtime = "nodejs"'));
  assert.ok(src.includes("z.object({"), "zod 入参校验");
  assert.ok(src.includes('aibiFail("UNAUTHORIZED", 401'), "未登录 401");
  assert.ok(src.includes('aibiFail("TOKEN_NOT_FOUND", 404'), "凭证不存在 404");
  assert.ok(src.includes('aibiFail("TOKEN_NOT_OWNED", 403'), "非持有者 403");
  assert.ok(src.includes('aibiFail("TOKEN_NOT_MINTED", 409'), "非 minted 409");
  assert.ok(src.includes("created: false"), "已有线程幂等返回");
  assert.ok(src.includes("INSERT INTO threads (user_id, title) VALUES ($1, $2) RETURNING id"), "建线程");
  assert.ok(
    src.includes("WHERE aibi_token_id = $2 AND thread_id IS NULL"),
    "并发守护：仅空值时回填",
  );
  assert.ok(src.includes('"BEGIN"') && src.includes('"COMMIT"') && src.includes('"ROLLBACK"'), "事务保护");
});

// ============ 6) /chat 页 aibi 反查 + 来源标识 ============
test("chat page: adoptions 未命中时按 thread_id 反查 aibi_tokens（仅 minted）", () => {
  const page = read("src/app/[locale]/chat/page.tsx");
  assert.ok(page.includes("FROM aibi_tokens t"), "反查凭证表");
  assert.ok(page.includes("WHERE t.thread_id = $1::uuid AND t.status = 'minted'"), "thread 反查 + minted 门槛");
  assert.ok(page.includes("petType = `aibi:${at.aibiTokenId}`;"), "petType=aibi: 编码");
  assert.ok(page.includes("Number(at.affinity ?? 0)"), "affinity → 心情条映射");
  assert.ok(page.includes("Number(at.growthLevel ?? 1)"), "growth_level → 等级");
  assert.ok(page.includes("border-violet-300"), "aibi 头像紫色边框（与经典橙色区分）");
  assert.ok(page.includes('tchat("aibiBadge")'), "线程来源徽章");
  assert.ok(page.includes('tchat("aibiWelcome", { name: pet.name })'), "aibi 欢迎语");
});

test("chat-panel: AgentAvatar 对 aibi（pet.emoji）渲染 emoji + 紫色边框", () => {
  const panel = read("src/components/chat/chat-panel.tsx");
  assert.ok(panel.includes("if (pet.emoji) {"), "emoji 分支");
  assert.ok(panel.includes("border-violet-300 bg-violet-50"), "紫色边框细微区分");
  assert.ok(
    panel.includes("sendMessage({ text }, { body: { petType, adoptionId } })"),
    "petType 随请求上送（aibi:<tokenId>）",
  );
});

// ============ 7) 入口：背包 / 详情页 ============
test("bag: /api/bag/aibis 携带 threadId + 卡片聊天按钮接线", () => {
  const api = read("src/app/api/bag/aibis/route.ts");
  assert.ok(api.includes('t.thread_id AS "threadId"'), "列表下发 threadId（owner-only 接口）");
  const bag = read("src/components/aibi/bag-client.tsx");
  assert.ok(bag.includes('import { AibiChatButton } from "./aibi-chat-button"'), "组件接线");
  assert.ok(
    bag.includes("<AibiChatButton aibiTokenId={tk.aibiTokenId} threadId={tk.threadId} />"),
    "每个 Aibi 卡片聊天按钮",
  );
});

test("aibi detail: 详情页聊天按钮（minted + 持有者）+ token API 隐私下放", () => {
  const client = read("src/components/aibi/aibi-page-client.tsx");
  assert.ok(client.includes('import { AibiChatButton } from "./aibi-chat-button"'), "组件接线");
  assert.ok(client.includes('detail.status === "minted"'), "仅 minted 显示");
  assert.ok(client.includes("threadId={detail.threadId}"), "threadId 透传按钮");
  const svc = read("src/lib/aibi-service.ts");
  assert.ok(svc.includes('t.thread_id AS "threadId"'), "readTokenDetail 查询含 threadId");
  const route = read("src/app/api/aibi/token/[tokenId]/route.ts");
  assert.ok(
    route.includes("const { ownerId, threadId, ...publicDetail } = detail;"),
    "threadId 默认剥离（不公开）",
  );
  assert.ok(route.includes("...(viewerIsOwner ? { threadId } : {})"), "仅持有者下放");
});

test("AibiChatButton: 有线程直跳 / 无线程 POST /api/threads 后跳 /chat?thread=", () => {
  const btn = read("src/components/aibi/aibi-chat-button.tsx");
  assert.ok(btn.includes("e.stopPropagation()"), "不触发卡片点击弹窗");
  assert.ok(btn.includes("router.push(`/chat?thread=${threadId}`)"), "有线程直跳");
  assert.ok(btn.includes('"/api/threads"'), "无线程创建接口");
  assert.ok(btn.includes("router.push(`/chat?thread=${res.threadId}`)"), "创建后跳转");
  for (const k of ["creatingThread", "chatAction", "startChatting"]) {
    assert.ok(btn.includes(`t("${k}")`), `三态文案 ${k}`);
  }
});

// ============ 8) i18n 五 key zh/en 对齐 + supports_chat 恢复 ============
test("i18n: chat 段 aibi 五 key zh/en 均存在且对齐", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  for (const k of ["aibiBadge", "aibiWelcome", "chatAction", "startChatting", "creatingThread"]) {
    assert.ok(zh.chat[k], `zh.chat.${k} missing`);
    assert.ok(en.chat[k], `en.chat.${k} missing`);
  }
  assert.ok(
    zh.chat.aibiWelcome.includes("{name}") && en.chat.aibiWelcome.includes("{name}"),
    "欢迎语占位符",
  );
});

test("catalog: supportsChat 全物种恢复 true（方案 a 落地，能力开关有真实消费路径）", () => {
  assert.equal(AIBI_SPECIES.length, 12);
  for (const s of AIBI_SPECIES) {
    assert.equal(s.supportsChat, true, `${s.id} supportsChat=true`);
  }
});

  assert.ok(route.includes("adoption?.memoryContext ?? null"), "aibi 无记忆列时为空");
});

