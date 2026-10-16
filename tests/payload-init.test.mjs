/**
 * 契约测试 · Payload CMS 初始化（Commit 1 payload-init）
 *
 *  A) payload.config.ts：适配器/独立 Turso env/路由/GraphQL 关闭/生成物路径锁定；
 *  B) .ts 显式扩展名红线：CLI 以 --disable-transpile（Node 原生 ESM）加载配置，
 *     相对导入无扩展名即 ERR_MODULE_NOT_FOUND（2026-10-18 排障结论）；
 *  C) Users / Media Collection 权限与上传契约；
 *  D) Next 接线：withPayload 包裹、@payload-config 别名、allowImportingTsExtensions；
 *  E) 后台搬家锁定：自研运营后台已迁 /console，/admin 专属 Payload，中间件/robots 同步；
 *  F) 生成物与依赖：importMap 非空、payload-types 已生成、cms:gen 脚本、本测试已挂载。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const exists = (p) => existsSync(join(ROOT, p));

// ─────────────────────── A) payload.config.ts 主配置 ───────────────────────
test("payload-init(A1): 主配置存在且核心项锁定", () => {
  const cfg = read("payload.config.ts");
  assert.ok(cfg.includes('from "@payloadcms/db-sqlite"'), "db-sqlite 适配器（db-libsql 包不存在）");
  assert.ok(cfg.includes("TURSO_DATABASE_URL"), "独立 TURSO_DATABASE_URL（不复用 Neon DATABASE_URL）");
  assert.ok(cfg.includes("TURSO_AUTH_TOKEN"), "TURSO_AUTH_TOKEN");
  assert.ok(cfg.includes('"file:payload.db"'), "本地缺省 file:payload.db 免 Turso");
  assert.ok(cfg.includes('admin: "/admin"'), "后台路由 /admin");
  assert.ok(cfg.includes('api: "/api/payload"'), "REST 路由 /api/payload（避开既有 /api/*）");
  assert.ok(cfg.includes("graphQL: { disable: true }"), "GraphQL 关闭（任务书）");
  assert.ok(cfg.includes("PAYLOAD_SECRET"), "PAYLOAD_SECRET 走 env（密钥零硬编码）");
  assert.ok(cfg.includes("lexicalEditor()"), "Lexical 富文本编辑器");
  assert.ok(cfg.includes("vercelBlobStorage"), "Media 走 Vercel Blob 条件插件");
  assert.ok(cfg.includes("BLOB_READ_WRITE_TOKEN"), "Blob 插件按 token 条件启用");
});

test("payload-init(A2): typescript/importMap 生成物路径锁定", () => {
  const cfg = read("payload.config.ts");
  assert.ok(cfg.includes('outputFile: path.resolve(dirname, "src/payload-types.ts")'), "types 输出 src/payload-types.ts");
  // 非 (payload) 路由组 → 必须显式 importMapFile，否则 CLI 只认 app/(payload)/admin
  assert.ok(cfg.includes("importMapFile"), "显式 importMapFile（无 (payload) 路由组）");
  assert.ok(cfg.includes("src/app/admin/importMap.ts"), "importMap 生成到 src/app/admin/");
});

test("payload-init(B): 相对导入显式 .ts 扩展名红线（--disable-transpile 原生 ESM）", () => {
  const cfg = read("payload.config.ts");
  assert.ok(cfg.includes('from "./src/collections/Users.ts"'), "Users 导入带 .ts");
  assert.ok(cfg.includes('from "./src/collections/Media.ts"'), "Media 导入带 .ts");
  // 反向锁：不允许退回无扩展名写法（原生 ESM 解析直接 ERR_MODULE_NOT_FOUND）
  assert.ok(!cfg.includes('from "./src/collections/Users"'), "禁止无扩展名导入");
  assert.ok(!cfg.includes('from "./src/collections/Media"'), "禁止无扩展名导入");
});

// ─────────────────────── C) Collections 契约 ───────────────────────
test("payload-init(C1): Users Collection（auth + role saveToJWT + admin 门禁）", () => {
  const c = read("src/collections/Users.ts");
  assert.ok(c.includes("auth: true"), "auth: true（自带登录端点）");
  assert.ok(c.includes('name: "role"'), "role 字段");
  assert.ok(c.includes("saveToJWT: true"), "saveToJWT（权限判断零查询）");
  assert.ok(c.includes('req.user?.role === "admin"'), "admin 角色门禁");
  assert.ok(c.includes("admin:"), "admin 面板准入钩子");
});

test("payload-init(C2): Media Collection（upload + 公开读 + admin 删 + 无 mimeTypes 白名单）", () => {
  const c = read("src/collections/Media.ts");
  assert.ok(c.includes("upload: true"), "upload: true");
  assert.ok(c.includes("read: () => true"), "素材公开可读");
  assert.ok(c.includes('req.user?.role === "admin"'), "delete 仅 admin");
  assert.ok(!c.includes("mimeTypes:"), "不设 mimeTypes 白名单属性（.riv MIME 不可控）");
});


// ─────────────────────── D) Next 接线 ───────────────────────
test("payload-init(D1): next.config 最外层 withPayload + tsconfig 别名/扩展名", () => {
  const next = read("next.config.ts");
  assert.ok(next.includes("withPayload"), "withPayload 包裹");
  assert.ok(next.includes("@payloadcms/next"), "@payloadcms/next 导入");
  const tsc = JSON.parse(read("tsconfig.json"));
  assert.equal(tsc.compilerOptions.paths["@payload-config"]?.[0], "./payload.config.ts", "@payload-config 别名");
  assert.equal(tsc.compilerOptions.allowImportingTsExtensions, true, "allowImportingTsExtensions（.ts 显式扩展名前置）");
});

test("payload-init(D2): .gitignore 忽略本地 sqlite 与上传目录", () => {
  const gi = read(".gitignore");
  assert.ok(gi.includes("/payload.db*"), "/payload.db* 忽略");
  assert.ok(gi.includes("/media/"), "/media/ 忽略");
});

// ─────────────────────── E) 后台搬家锁定 ───────────────────────
test("payload-init(E1): /admin 专属 Payload，自研后台已迁 /console", () => {
  assert.ok(exists("src/app/admin/layout.tsx"), "Payload admin layout 存在");
  assert.ok(exists("src/app/admin/[[...segments]]/page.tsx"), "Payload admin RootPage 存在");
  assert.ok(exists("src/app/api/payload/[...slug]/route.ts"), "Payload REST 路由存在");
  // 自研后台页面不得在 /admin 残留（git mv → console）
  for (const p of ["dashboard", "moderation", "economy", "news", "pets"]) {
    assert.ok(!exists(`src/app/admin/${p}`), `src/app/admin/${p} 已迁走`);
    assert.ok(exists(`src/app/console/${p}/page.tsx`), `src/app/console/${p} 存在`);
  }
});

test("payload-init(E2): 中间件/robots/控制台菜单同步", () => {
  const mw = read("src/middleware.ts");
  assert.ok(mw.includes("|admin|"), "matcher 排除 admin（Payload 自管鉴权）");
  assert.ok(mw.includes("|console|"), "matcher 排除 console");
  const robots = read("src/app/robots.ts");
  assert.ok(robots.includes('"/admin/"'), "robots disallow /admin/");
  assert.ok(robots.includes('"/console/"'), "robots disallow /console/");
  const shell = read("src/components/admin/admin-shell.tsx");
  assert.ok(shell.includes("/console/dashboard"), "自研后台菜单指向 /console/*");
  assert.ok(shell.includes("/admin"), "菜单含 Payload CMS 后台 ↗ 入口");
});

// ─────────────────────── F) 生成物与依赖 ───────────────────────
test("payload-init(F1): importMap 已生成且非空", () => {
  const im = read("src/app/admin/importMap.ts");
  assert.ok(im.includes("export const importMap"), "importMap 导出");
  assert.ok(im.includes("#CollectionCards"), "含生成条目（证明 generate:importmap 已执行）");
  assert.ok(!im.includes("export const importMap = {}"), "不得回退为空占位");
});

test("payload-init(F2): payload-types.ts 已生成", () => {
  assert.ok(exists("src/payload-types.ts"), "src/payload-types.ts 存在");
  const t = read("src/payload-types.ts");
  assert.ok(t.includes("users") && t.includes("media"), "含 users/media 类型");
});

test("payload-init(F3): package.json 依赖/cms:gen 脚本/本测试挂载", () => {
  const pkg = JSON.parse(read("package.json"));
  for (const dep of ["payload", "@payloadcms/next", "@payloadcms/db-sqlite", "@payloadcms/richtext-lexical", "@payloadcms/storage-vercel-blob", "@payloadcms/translations"]) {
    assert.ok(pkg.dependencies[dep], `依赖 ${dep}`);
  }
  assert.ok(pkg.scripts["cms:gen"], "cms:gen 脚本（--disable-transpile 红线封装）");
  assert.ok(pkg.scripts["cms:gen"].includes("--disable-transpile"), "脚本封装 --disable-transpile");
  assert.ok(pkg.scripts.test.includes("payload-init.test.mjs"), "本测试已挂载 npm test");
});
