/**
 * P2 社交传播 · 明信片墙公开页契约测试（改动二）
 *
 * 覆盖（验收口径：公开页可访问、系列进度正确、默认无公开外露）：
 *  1) schema：users.postcard_wall_public（默认 false）+ 0032 幂等迁移 + SCHEMA_VERSION 17；
 *  2) profile API：GET 返回 + PATCH 布尔校验 + returning；
 *  3) 共享查询 getPublicPostcardWall：隐私门 + 与 P1 本人视角同口径（event_id 去重）；
 *  4) 公开 API /api/postcard-wall/[userId]：匿名可读 + 未开 404；
 *  5) 汇总分享图 share.png：1200×630 + 五系列进度 + 集齐金标 + SITE_URL 水印 + 404；
 *  6) 公开页 /postcard-wall/[userId]：noindex + notFound + 金框 + "?" 占位 + 分享按钮；
 *  7) settings 开关 + profile 入口 + i18n（zh/en 对齐）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const zh = JSON.parse(read("messages/zh.json"));
const en = JSON.parse(read("messages/en.json"));

// === 1) schema ===
test("schema: postcard_wall_public default false + 0032 idempotent + SCHEMA_VERSION 17", () => {
  const schema = read("src/db/schema.ts");
  assert.match(schema, /postcardWallPublic: boolean\('postcard_wall_public'\)\.notNull\(\)\.default\(false\)/);
  const client = read("src/db/client.ts");
  assert.match(client, /ADD COLUMN IF NOT EXISTS "postcard_wall_public" boolean DEFAULT false NOT NULL/);
  assert.match(client, /SCHEMA_VERSION = 17;/);
  const sql = read("drizzle/0032_postcard_wall_public.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "postcard_wall_public"/);
});

// === 2) profile API 开关 ===
test("profile route: GET returns + PATCH validates postcardWallPublic boolean", () => {
  const r = read("src/app/api/user/profile/route.ts");
  assert.ok(r.includes("postcardWallPublic: users.postcardWallPublic"), "GET select");
  assert.ok(r.includes('hasOwnProperty.call(body, "postcardWallPublic")'), "PATCH presence check");
  assert.ok(r.includes('typeof body.postcardWallPublic !== "boolean"'), "PATCH type check");
  assert.ok(r.includes("updates.postcardWallPublic = body.postcardWallPublic"), "PATCH apply");
});

// === 3) 共享查询（隐私门 + P1 同口径） ===
test("shared query: privacy gate + same counting as owner view", () => {
  const q = read("src/server/queries/postcard-wall-queries.ts");
  assert.ok(q.includes("postcard_wall_public AS pub"), "reads public flag");
  assert.ok(q.includes("if (!owner || !flagRows[0]?.pub) return null"), "gate → null");
  assert.ok(q.includes("r.result_type = 'postcard'"), "postcard rows only");
  assert.ok(q.includes("eventsByCategory.get(cat)!.add(String(row.eventId))"), "event_id dedupe");
  assert.ok(q.includes("postcardSetBadgeId(category)"), "claimed via achievements");
});


// === 4) 公开 API ===
test("public API: anonymous read + 404 when not public", () => {
  const r = read("src/app/api/postcard-wall/[userId]/route.ts");
  assert.ok(!r.includes("getUserFromRequest"), "no auth required");
  assert.ok(r.includes("getPublicPostcardWall(userId)"), "shared query");
  assert.ok(r.includes("status: 404"), "404 when private/missing");
  assert.ok(!r.includes("export async function POST"), "readonly (no claim)");
});

// === 5) 汇总分享图 ===
test("public share.png: 1200x630 + 5-set progress + complete mark + site watermark", () => {
  const c = read("src/app/api/postcard-wall/[userId]/share.png/route.tsx");
  assert.ok(c.includes("width: 1200"), "1200 wide");
  assert.ok(c.includes("height: 630"), "630 tall");
  assert.ok(c.includes("POSTCARD_SETS.map"), "five series rows");
  assert.ok(c.includes("SET_COLORS"), "series colors (no emoji in satori)");
  assert.ok(c.includes('"已集齐"') && c.includes('"DONE"'), "complete mark zh/en");
  assert.ok(c.includes("new URL(SITE_URL).host"), "site watermark");
  assert.ok(c.includes('return new Response("Not Found", { status: 404 })'), "privacy 404");
  assert.ok(c.includes("loadCjkFont"), "CJK font reuse");
});

// === 6) 公开页 ===
test("public page: noindex + notFound + gold frame + ? placeholders + share button", () => {
  const p = read("src/app/[locale]/postcard-wall/[userId]/page.tsx");
  assert.ok(p.includes("robots: { index: false, follow: false }"), "noindex");
  assert.ok(p.includes("notFound()"), "404 when private/missing");
  assert.ok(p.includes("border-amber-400"), "gold frame for complete set");
  assert.ok(p.includes('t("completeBadge")'), "complete badge");
  assert.ok(p.includes("Array.from({ length: missing })"), "? placeholders");
  assert.ok(p.includes("<PublicWallShareButton"), "share button mounted");
  const b = read("src/components/exploration-v2/public-wall-share-button.tsx");
  assert.ok(b.includes("navigator.canShare?.({ files: [file] })"), "system share");
  assert.ok(b.includes("a.download = file.name"), "download fallback");
  assert.ok(b.includes("/share.png"), "OG summary image");
});

// === 7) settings 开关 + profile 入口 + i18n ===
test("settings toggle + profile entry + i18n aligned zh/en", () => {
  const s = read("src/app/[locale]/settings/page.tsx");
  assert.ok(s.includes("toggleWallPublic"), "toggle fn");
  assert.ok(s.includes("patch({ postcardWallPublic: next })"), "PATCH switch");
  assert.ok(s.includes("aria-checked={wallPublic}"), "switch a11y");
  const prof = read("src/components/aibi/profile-client.tsx");
  assert.ok(prof.includes("href={`/postcard-wall/${me.id}`}"), "profile entry link");
  for (const dict of [zh, en]) {
    const pw = dict.explorationV2?.postcardWall;
    const keys = ["publicBadge", "publicTitle", "totalLine", "completeBadge", "shareWall", "sharing", "shareWallText"];
    for (const k of keys) assert.ok(pw[k], `postcardWall.${k}`);
    assert.ok(pw.publicTitle.includes("{name}"), "publicTitle param");
    assert.ok(pw.shareWallText.includes("{url}"), "shareWallText url param");
    assert.ok(dict.settings?.wallPublicLabel && dict.settings?.wallPublicDesc, "settings i18n");
    assert.ok(dict.aibi?.profilePage?.postcardWallEntry, "profile entry i18n");
  }
});
