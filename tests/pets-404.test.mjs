// /pets/[id] 软 404 防护契约测试（2026-10-02）
// 背景：不存在的 speciesId（如 /pets/nonexistent）必须返回标准 404，而非 200 + 空页面，
//       避免搜索引擎误判为有效页面。生产实测（2026-10-02 curl）：
//         /zh/pets/nonexistent -> 404，/en/pets/nonexistent -> 404，/zh/pets/penguin -> 200。
// 本套件以源码契约锁死该行为防回归（离线可跑，无网络/DB 依赖）：
//   1) SSR 入口查询 pet_dictionary 后存在 notFound() 判空分支
//   2) generateMetadata 对无效物种不产出任何 SEO 字段（仅对有效物种生效）
//   3) locale 级 not-found 边界存在（notFound() 的渲染落点）
//   4) 页面 force-dynamic（防静态化/ISR 把 200/404 判定固化）
//   5) 有效物种 SEO 回归保护：OG 分享字段 + canonical url + 页面 JSON-LD 保持原样
//   6) sitemap 仅从 pet_dictionary 收录有效物种（nonexistent 不会进入 sitemap）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const PAGE = "src/app/[locale]/pets/[id]/page.tsx";

test("404: SSR 入口查询 pet_dictionary 后存在 notFound() 判空分支", () => {
  const src = read(PAGE);
  assert.ok(
    src.includes('import { notFound } from "next/navigation";'),
    "页面必须自 next/navigation 导入 notFound",
  );
  // 页面主体：查 pet_dictionary → rows[0] 为空 → notFound()（必须位于组件主体而非仅 metadata）
  const bodyStart = src.indexOf("export default async function PetSpeciesPage");
  assert.ok(bodyStart > 0, "未找到 PetSpeciesPage 组件");
  const body = src.slice(bodyStart);
  assert.ok(
    body.includes("FROM pet_dictionary d WHERE d.id = $1 LIMIT 1"),
    "SSR 入口必须按 id 查询 pet_dictionary",
  );
  assert.ok(body.includes("if (!s) notFound();"), "查询判空后必须调用 notFound()");
});

test("404: generateMetadata 对无效物种不产出 SEO 字段（return {} 先于 OG 构造）", () => {
  const src = read(PAGE);
  const metaStart = src.indexOf("export async function generateMetadata");
  const metaEnd = src.indexOf("export default async function");
  assert.ok(metaStart > 0 && metaEnd > metaStart, "未找到 generateMetadata");
  const meta = src.slice(metaStart, metaEnd);
  const guardIdx = meta.indexOf("if (!s) return {};");
  const ogIdx = meta.indexOf("openGraph");
  assert.ok(guardIdx > 0, "generateMetadata 必须含无效物种判空 return {}");
  assert.ok(ogIdx > guardIdx, "判空必须先于 openGraph 构造，保证仅对有效物种生效");
});

test("404: locale 级 not-found 边界存在（notFound() 的 404 渲染落点）", () => {
  assert.ok(
    existsSync(join(ROOT, "src/app/[locale]/not-found.tsx")),
    "缺少 src/app/[locale]/not-found.tsx，notFound() 将无 404 页面可渲染",
  );
});

test("404: 无静态化/ISR 配置，每个 id 实时经 DB 判空（防 200/404 判定被固化）", () => {
  const src = read(PAGE);
  // 生产响应头实测（2026-10-02）：Cache-Control: private, no-cache, no-store → 按需 SSR。
  // 以下任一配置出现都会破坏该语义，需显式评审后方可引入：
  assert.ok(
    !src.includes('export const dynamic = "force-static"'),
    "不得 force-static（会把 unknown id 的首次渲染结果缓存固化）",
  );
  assert.ok(
    !/export const revalidate\s*=/.test(src),
    "不得新增 ISR revalidate（会缓存 404/200 判定）",
  );
  assert.ok(
    !src.includes("generateStaticParams"),
    "不得引入 generateStaticParams（收窄 id 空间，绕过 DB 实时判空）",
  );
});

test("404: 有效物种 SEO 回归保护（OG 分享字段 / canonical / JSON-LD 保持原样）", () => {
  const src = read(PAGE);
  assert.ok(src.includes("...ogShareFields(locale)"), "OG 分享字段不得移除");
  assert.ok(
    src.includes("url: `${SITE_URL}/${locale}/pets/${id}`"),
    "OG canonical url 形态不得变更",
  );
  assert.ok(src.includes('type="application/ld+json"'), "页面 JSON-LD 不得移除");
  assert.ok(
    src.includes('export const revalidate = 86400;') === false,
    "不得新增 ISR revalidate（会缓存 404/200 判定）",
  );
});

test("404: sitemap 仅从 pet_dictionary 收录有效物种", () => {
  const sitemap = read("src/app/sitemap.ts");
  assert.ok(
    sitemap.includes("FROM pet_dictionary"),
    "sitemap 物种来源必须是 pet_dictionary（nonexistent 不会入库即不会收录）",
  );
  assert.ok(
    sitemap.includes("/pets/${String(s.id)}"),
    "sitemap 详情页 URL 形态不得变更",
  );
});
