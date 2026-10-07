// Phase 10 灵宠日常短视频契约测试
//
// 覆盖：
//  1) drizzle/0036 + scripts/migrate-video-table.sql：video_generations 表 + 3 索引 + users.video_quota，幂等；
//  2) client.ts：SCHEMA_VERSION 21 + DDL/索引/补列入运行时同步；
//  3) schema.ts：videoGenerations 表 + users.videoQuota 列；
//  4) pet-video.ts：env 回退链（KLING_API_KEY→BAILIAN_API_KEY）/ 双 provider 字段映射 / 9:16·5s·audio 参数 /
//     generateThrottled（Phase 8 并发槽+降级）/ 本地模板兜底 / 事务占位 / failed 不计数=自动退还 / Blob 转存；
//  5) generate 路由：401/限流/503 降级/归属校验/配额 429/占位→脚本→提交→bind/失败退还；
//  6) poll 路由：id/petId/sweep 三模式 / CRON_SECRET / owner 校验 / 超时退还 / Blob 转存降级；
//  7) 前端：页面 noindex + 客户端状态机（5s 轮询/水印/下载/分享）+ companion-panel 入口；
//  8) i18n：zh/en petVideo 21 keys 对齐 + api.video* 8 错误文案；vercel.json cron sweep。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const exists = (p) => existsSync(join(ROOT, p));

// ───────────── 1) 迁移文件 ─────────────
test("phase10: drizzle/0036 + 手动迁移副本齐备且幂等", () => {
  for (const f of ["drizzle/0036_pet_video.sql", "scripts/migrate-video-table.sql"]) {
    assert.ok(exists(f), `${f} exists`);
    const sql = read(f);
    assert.ok(/CREATE TABLE IF NOT EXISTS "video_generations"/.test(sql), "video_generations 幂等建表");
    for (const col of ["user_id", "pet_id", "task_id", "status", "script", "video_url", "source_url", "error", "created_at", "updated_at"]) {
      assert.ok(sql.includes(`"${col}"`), `列 ${col}`);
    }
    assert.ok(sql.includes("idx_video_generations_user_day"), "当日配额索引");
    assert.ok(sql.includes("idx_video_generations_task"), "任务反查索引");
    assert.ok(sql.includes("idx_video_generations_status"), "sweep 状态索引");
    assert.ok(/ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "video_quota" integer DEFAULT 1 NOT NULL/.test(sql), "users.video_quota 默认 1（免费每日 1 次）");
  }
});

// ───────────── 2) client.ts 运行时同步 ─────────────
test("phase10: client.ts SCHEMA_VERSION=21 + DDL/索引/补列", () => {
  const c = read("src/db/client.ts");
  assert.match(c, /const SCHEMA_VERSION = 21;/, "SCHEMA_VERSION bumped to 21");
  assert.ok(c.includes('CREATE TABLE IF NOT EXISTS "video_generations"'), "建表 DDL 入 SCHEMA_CREATES");
  assert.ok(c.includes('ADD COLUMN IF NOT EXISTS "video_quota"'), "video_quota 补列幂等");
  for (const idx of ["idx_video_generations_user_day", "idx_video_generations_task", "idx_video_generations_status"]) {
    assert.ok(c.includes(`CREATE INDEX IF NOT EXISTS ${idx}`), `${idx} 入 SCHEMA_INDEXES`);
  }
});

// ───────────── 3) schema.ts ─────────────
test("phase10: schema.ts videoGenerations + users.videoQuota", () => {
  const s = read("src/db/schema.ts");
  assert.ok(s.includes("videoGenerations = pgTable('video_generations'"), "videoGenerations 表导出");
  assert.ok(s.includes("videoQuota: integer('video_quota').notNull().default(1)"), "users.videoQuota 默认 1");
  assert.ok(s.includes("sourceUrl: text('source_url')"), "平台临时链接留档列");
});

// ───────────── 4) pet-video.ts 核心库 ─────────────
test("phase10: pet-video.ts env 回退链 + 双 provider + 生成参数", () => {
  const l = read("src/lib/pet-video.ts");
  assert.ok(l.includes("process.env.KLING_API_KEY || process.env.BAILIAN_API_KEY"), "KLING_API_KEY 缺省回退 BAILIAN_API_KEY");
  assert.ok(l.includes("https://dashscope.aliyuncs.com/api/v1"), "默认百炼 DashScope 端点");
  assert.ok(l.includes("kling-v3-turbo-video-generation"), "默认可灵模型名（env 可覆盖）");
  assert.ok(l.includes('includes("klingai")'), "可灵官方平台自动识别");
  assert.ok(l.includes("/v1/videos/image2video"), "可灵官方提交端点");
  assert.ok(l.includes('aspect_ratio: "9:16"'), "可灵官方 9:16 竖屏");
  assert.ok(l.includes("/services/aigc/video-generation/video-synthesis"), "DashScope 提交端点");
  assert.ok(l.includes('"X-DashScope-Async": "enable"'), "DashScope 异步模式头");
  assert.ok(l.includes('size: "720*1280"'), "DashScope 竖屏尺寸");
  assert.ok(l.includes("duration: 5") && l.includes("audio: true"), "5 秒 + 声音");
  assert.ok(l.includes('"SUCCEEDED"') && l.includes('"succeed"'), "双 provider 成功态归一");
  assert.ok(l.includes("video_url") && l.includes("task_result"), "双 provider 结果字段");
});

test("phase10: pet-video.ts AI 脚本走 Phase 8 通道 + 本地兜底", () => {
  const l = read("src/lib/pet-video.ts");
  assert.ok(l.includes('from "@/lib/llm-fallback"') && l.includes("generateThrottled"), "经 Phase 8 并发槽+跨 provider 降级");
  assert.ok(l.includes("AiBusyError"), "AI 繁忙识别");
  assert.ok(l.includes("fallbackVideoScript"), "本地模板兜底（零 LLM 成本）");
  assert.ok(l.includes('source: "fallback"'), "兜底来源标记");
  assert.ok(l.includes("subtitle") && l.includes("bgmStyle") && l.includes("scene"), "脚本含画面/字幕/BGM 三要素");
});

test("phase10: pet-video.ts 配额事务占位 + 失败自动退还 + Blob 转存", () => {
  const l = read("src/lib/pet-video.ts");
  assert.ok(l.includes("BEGIN") && l.includes("COMMIT") && l.includes("ROLLBACK"), "占位单事务（并发权威计数）");
  assert.ok(l.includes("status <> 'failed'"), "failed 不计入当日计数 = 失败自动退还");
  assert.ok(l.includes("video_quota"), "读取 users.video_quota（预留付费扩容）");
  assert.ok(l.includes("markVideoFailed"), "失败落库退还");
  assert.ok(l.includes("bindVideoTask"), "占位后绑定 task_id+脚本");
  assert.ok(l.includes('from "@vercel/blob"') && l.includes("put("), "Vercel Blob 转存（链接不过期）");
  assert.ok(l.includes('access: "public"') && l.includes('"video/mp4"'), "Blob 公开读 + mp4 类型");
});

// ───────────── 5) generate 路由 ─────────────
test("phase10: generate 路由鉴权/限流/降级/归属/配额/退还", () => {
  const r = read("src/app/api/pets/[id]/video/generate/route.ts");
  assert.ok(r.includes("getUserFromRequest") && r.includes('apiError(locale, "signInFirst")'), "未登录 401");
  assert.ok(r.includes("RATE_LIMITS.video"), "小时级限流防连点");
  assert.ok(r.includes("klingConfigured()") && r.includes("503"), "未配置可灵 → 503 降级");
  assert.ok(r.includes("WHERE id = $1 AND user_id = $2"), "灵宠归属校验（防越权）");
  assert.ok(r.includes("videoQuotaExceeded"), "配额超限 429");
  assert.ok(r.includes("createVideoGeneration") && r.includes("bindVideoTask"), "先占位再提交（拒绝零外部成本）");
  assert.ok(r.includes("markVideoFailed") && r.includes("refunded: true"), "提交失败退还次数");
  assert.ok(r.includes("SITE_URL"), "本地立绘拼公网绝对地址（可灵 first_frame）");
  assert.ok(r.includes("image_url LIKE 'http%'"), "物种实例图限公网 URL");
  assert.ok(r.includes("maxDuration = 60"), "函数时长声明");
});

// ───────────── 6) poll 路由 ─────────────
test("phase10: poll 路由三模式 + 归属校验 + 超时退还 + 转存", () => {
  const r = read("src/app/api/video/poll/route.ts");
  assert.ok(r.includes('searchParams.get("mode") === "sweep"'), "cron sweep 模式");
  assert.ok(r.includes("CRON_SECRET") && r.includes("Bearer"), "sweep CRON_SECRET 鉴权");
  assert.ok(r.includes('searchParams.get("petId")'), "页面刷新恢复模式");
  assert.ok(r.includes("AND user_id = $2"), "用户模式归属校验");
  assert.ok(r.includes("TASK_TIMEOUT_MS"), "平台超时兜底");
  assert.ok(r.includes("poll timeout") && r.includes("markVideoFailed"), "超时标记失败（退还）");
  assert.ok(r.includes("archiveVideoToBlob"), "成功后转存 Blob");
  assert.ok(r.includes("archived ?? r.videoUrl"), "Blob 失败降级临时链接");
  assert.ok(r.includes("interval '2 minutes'") && r.includes("LIMIT 8"), "sweep 批量限时保护");
});


// ───────────── 7) 前端 ─────────────
test("phase10: 视频页 + 客户端状态机 + 入口", () => {
  const p = read("src/app/[locale]/pets/[id]/video/page.tsx");
  assert.ok(p.includes("index: false"), "私有功能页 noindex");
  assert.ok(p.includes("PetVideoClient") && p.includes("setRequestLocale"), "SSR 壳 + 客户端组件 + next-intl 静态化");

  const c = read("src/components/pet-video-client.tsx");
  assert.ok(c.includes("POLL_INTERVAL_MS = 5000"), "5s 前端轮询（hobby cron 无法 30s，前端承担实时轮询）");
  assert.ok(c.includes("/api/video/poll?id="), "轮询单任务");
  assert.ok(c.includes("/api/video/poll?petId="), "刷新恢复进行中任务");
  assert.ok(c.includes("aiabw_token") && c.includes("/login?redirect="), "未登录跳登录回跳");
  assert.ok(c.includes("aiabw.com"), "播放器水印叠层（官网链接）");
  assert.ok(c.includes("navigator.share") && c.includes("clipboard.writeText"), "分享：系统分享优先 + 剪贴板兜底");
  assert.ok(c.includes("download"), "下载按钮");
  assert.ok(c.includes('aspectRatio: "9 / 16"'), "9:16 竖屏舞台");
  assert.ok(c.includes("pet-video-player"), "播放器 testid");

  const panel = read("src/components/pets/companion-panel.tsx");
  assert.ok(panel.includes("/pets/${pet.id}/video"), "灵宠卡片「生成日常视频」入口");
  assert.ok(panel.includes('useTranslations("petVideo")'), "入口 i18n 钩子");
});

// ───────────── 8) i18n + cron + 限流规则 ─────────────
test("phase10: i18n 双语对齐 + cron + 限流规则", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  assert.ok(zh.petVideo && en.petVideo, "petVideo 命名空间双语");
  const zk = Object.keys(zh.petVideo).sort();
  const ek = Object.keys(en.petVideo).sort();
  assert.deepEqual(zk, ek, "petVideo 双语 key 完全对齐");
  assert.ok(zk.length >= 20, "petVideo 文案齐备");
  for (const k of ["videoUnavailable", "videoPetNotFound", "videoQuotaExceeded", "videoSubmitFailed", "videoGenerateFailed", "videoNotFound", "videoPollBadRequest", "videoPollFailed"]) {
    assert.ok(zh.api[k] && en.api[k], `api.${k} 双语`);
  }
  assert.ok(zh.petVideo.shareText.includes("{url}"), "分享文案带官网链接位");

  const v = JSON.parse(read("vercel.json"));
  assert.ok(
    v.crons.some((c) => c.path === "/api/video/poll?mode=sweep"),
    "vercel.json 注册 sweep cron（hobby 每日兜底；实时轮询由前端承担）",
  );

  const rl = read("src/lib/rate-limit.ts");
  assert.ok(rl.includes("video: { limit: 6, windowSec: 3600 }"), "RATE_LIMITS.video 规则");
});

