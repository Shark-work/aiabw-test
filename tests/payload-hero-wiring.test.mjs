/**
 * 契约测试 · HomeHero 读取侧接线（任务二：后台改首页主视觉，60s 内前台生效）
 *
 *  A) RSC 壳 page.tsx：getHomeHero() 读取 → HomeHeroView 可序列化（upload 提取 url，
 *     backgroundImage 优先 / backgroundPath 兜底）→ <HomeClient hero={view} />；
 *     CMS 空表 → hero=null 降级；
 *  B) home-client.tsx：标题/副标题/三 CTA 文案与链接/背景图/灵魂树开关全部字段级回退
 *     i18n 与现状硬编码（CMS 字段留空 = 接入前渲染一致）；
 *  C) 结构完整性：首页全部既有区块保留（RSC 壳拆分零功能丢失——旧断言锁定内容所在地）；
 *  D) 本测试已挂载 npm test。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ─────────────────────── A) RSC 壳 ───────────────────────
test("hero-wiring(A): page.tsx RSC 壳读取 HomeHero + upload 提取 + 空表降级 null", () => {
  const p = read("src/app/[locale]/page.tsx");
  assert.ok(!p.includes('"use client"'), "壳为 RSC（非客户端组件）");
  assert.ok(p.includes('import { getHomeHero } from "@/lib/cms/loaders"'), "引入 loader");
  assert.ok(p.includes("await getHomeHero()"), "读取 HomeHero");
  assert.ok(p.includes('from "@/components/home/home-client"'), "渲染 HomeClient");
  assert.ok(p.includes("<HomeClient hero={view} />"), "hero 视图下发");
  assert.ok(p.includes("typeof bgMedia.url === \"string\""), "upload 对象提取 url");
  assert.ok(p.includes("hero?.backgroundPath?.trim()"), "backgroundPath 兜底");
  assert.ok(p.includes("soulTreeEnabled: hero.soulTreeEnabled"), "彩蛋开关下发");
  assert.ok(p.includes(": null;"), "CMS 空表 → view=null 降级");
});

// ─────────────────────── B) home-client 字段级回退 ───────────────────────
test("hero-wiring(B): home-client Hero 区块全字段 CMS 优先 + i18n/硬编码回退", () => {
  const c = read("src/components/home/home-client.tsx");
  assert.ok(c.includes('"use client"'), "客户端组件（交互保留）");
  assert.ok(c.includes("export function HomeClient({ hero = null }"), "hero prop（缺省 null）");
  assert.ok(c.includes("export interface HomeHeroView"), "可序列化视图类型导出");
  // 标题/副标题（sr-only h1 与可视主标题同源）
  assert.ok(c.includes('locale === "en" ? hero?.titleEn : hero?.titleZh'), "标题按语言取 CMS");
  assert.ok(c.includes('t("title")'), "标题回退 i18n");
  assert.ok(c.includes("settings?.sloganEn") || c.includes("hero?.subtitleEn : hero?.subtitleZh"), "副标题按语言取 CMS");
  assert.ok((c.match(/\{heroTitle\}/g) ?? []).length >= 2, "sr-only h1 与可视主标题同走 heroTitle");
  // 三 CTA（文案 + 链接均可后台改）
  assert.ok(c.includes('hero?.ctaPrimaryUrl?.trim() || "/pets"'), "主 CTA 链接回退 /pets（现状）");
  assert.ok(c.includes('hero?.ctaExploreUrl?.trim() || "/explore-v2"'), "探索 CTA 链接回退");
  assert.ok(c.includes('hero?.ctaShopUrl?.trim() || "/shop"'), "商城 CTA 链接回退");
  assert.ok(c.includes("{ctaPrimary.text}") && c.includes("{ctaExplore.text}") && c.includes("{ctaShop.text}"), "CTA 文案消费");
  // 背景图 + 灵魂树开关
  assert.ok(c.includes('hero?.backgroundUrl?.trim() || "/resources/background_clothing/bg1.webp"'), "背景回退 bg1.webp 现状");
  assert.ok(c.includes("url('${heroBgUrl}')"), "背景消费");
  assert.ok(c.includes("hero?.soulTreeEnabled !== false &&"), "灵魂树仅显式 false 隐藏（缺省保留现状）");
  // 字段级回退密度（全部 .trim() || 形式）
  assert.ok((c.match(/\.trim\(\) \|\|/g) ?? []).length >= 9, "全字段 trim 空值回退");
});

// ─────────────────────── C) 结构完整性 ───────────────────────
test("hero-wiring(C): 既有区块零丢失（HomeAibiSection/SoulCardCarousel/SoulTreeEgg/推荐宠）", () => {
  const c = read("src/components/home/home-client.tsx");
  for (const marker of [
    "<HomeAibiSection />", "<SoulCardCarousel />", "<CommunityStats />",
    "<OnboardingBanner />", "<RecallBanner />", "SoulTreeEgg",
    "PetDetailModal", "UpgradePetModal", "/api/pets/featured",
  ]) {
    assert.ok(c.includes(marker), `保留 ${marker}`);
  }
});

// ─────────────────────── D) 挂载 ───────────────────────
test("hero-wiring(D): 本测试已挂载 npm test", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts.test.includes("payload-hero-wiring.test.mjs"), "已挂载 npm test");
});
