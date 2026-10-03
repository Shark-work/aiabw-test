// 收藏中心三 Tab 重构（2026-10-06）契约测试：
//  1) /soul-cards 页挂载 CollectionClient（Suspense），不再直接拼合两个旧面板；
//  2) CollectionClient：三 Tab（aibi/soul/nfr）+ URL query ?tab= 状态 + 复用旧面板不重写；
//  3) NfrGalleryPanel：消费 GET /api/gallery?mine=1（Bearer + x-locale），
//     登录引导 / 空状态引导去 /blindbox / 稀有度徽章复用 getRarityMeta；
//  4) i18n collection 命名空间 zh/en 深键完全对齐；
//  5) 保护性断言：/api/gallery 路由本体未被改动（保留 mine=1 分支与公开 GET）。
// 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/collection-center.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

test("page: /soul-cards 挂载 CollectionClient（Suspense），不再直接拼合旧面板", () => {
  const page = read("src/app/[locale]/soul-cards/page.tsx");
  assert.ok(page.includes("<CollectionClient />"), "收藏中心容器挂载");
  assert.ok(page.includes("<Suspense"), "useSearchParams 的 Suspense 边界");
  assert.ok(!page.includes("<AibiSoulPanel />"), "页面不再直接拼合 AibiSoulPanel");
  assert.ok(!page.includes("<SoulCardsClient />"), "页面不再直接拼合 SoulCardsClient");
});

test("container: 三 Tab + URL query 状态 + 旧面板原样复用", () => {
  const cc = read("src/components/collection/collection-client.tsx");
  assert.ok(cc.includes('["aibi", "soul", "nfr"]'), "三 Tab 定义");
  assert.ok(cc.includes('searchParams.get("tab")'), "Tab 状态来自 URL query");
  assert.ok(cc.includes("router.replace("), "切换 Tab 写回 ?tab=");
  assert.ok(cc.includes("<AibiSoulPanel />"), "aibi Tab 复用 5.4 面板");
  assert.ok(cc.includes("<SoulCardsClient />"), "soul Tab 复用 V1 面板");
  assert.ok(cc.includes("<NfrGalleryPanel />"), "nfr Tab 挂载藏品面板");
  assert.ok(cc.includes('useTranslations("collection")'), "collection 命名空间");
});

test("nfr panel: 消费 /api/gallery?mine=1 + 鉴权策略 + 空状态引导盲盒", () => {
  const panel = read("src/components/collection/nfr-gallery-panel.tsx");
  assert.ok(panel.includes('fetch("/api/gallery?mine=1"'), "数据源 /api/gallery?mine=1");
  assert.ok(panel.includes("Authorization: `Bearer ${token}`"), "Bearer 鉴权");
  assert.ok(panel.includes('"x-locale": locale'), "本地化请求头");
  assert.ok(panel.includes('localStorage.getItem("aiabw_token")'), "登录态读取");
  assert.ok(panel.includes('href="/login"'), "未登录引导");
  assert.ok(panel.includes('href="/blindbox"'), "空状态引导去盲盒广场");
  assert.ok(panel.includes("getRarityMeta"), "稀有度徽章复用 pet-status");
  assert.ok(panel.includes('useTranslations("collection.nfr")'), "collection.nfr 命名空间");
});

test("i18n: collection 命名空间 zh/en 深键完全对齐", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  const flatten = (obj, prefix = "") =>
    Object.entries(obj ?? {}).flatMap(([k, v]) =>
      v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );
  const zk = flatten(zh.collection).sort();
  const ek = flatten(en.collection).sort();
  assert.ok(zk.length > 0, "zh.collection 非空");
  assert.deepEqual(zk, ek, "collection 命名空间 zh/en 键集合必须一致");
  for (const ns of ["tabs", "nfr"]) {
    assert.ok(zh.collection[ns] && en.collection[ns], `缺子命名空间 ${ns}`);
  }
});

test("protect: /api/gallery 路由本体保持原样（mine=1 分支 + 公开 GET）", () => {
  const api = read("src/app/api/gallery/route.ts");
  assert.ok(api.includes('url.searchParams.get("mine") === "1"'), "mine=1 分支保留");
  assert.ok(api.includes("digital_collectibles dc"), "数据源 digital_collectibles");
  assert.ok(api.includes("user_collectibles"), "JOIN user_collectibles");
  assert.ok(api.includes("export async function GET"), "公开 GET 保留");
});
