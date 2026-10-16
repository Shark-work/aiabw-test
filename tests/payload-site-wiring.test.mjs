/**
 * 契约测试 · SiteSettings 读取侧接线（任务一：后台改站点设置，全站 title/footer 同步）
 *
 *  A) layout generateMetadata：getSiteSettings 读取 → siteName 组 title / slogan 组
 *     description / faviconUrl 覆盖 icons / og:siteName 同步；空值回退 i18n（<title> 永不为空）；
 *  B) layout body：SiteJsonLd 名称/描述/Logo 走 CMS（logoUrl 缺省 /icon.svg）；
 *  C) Footer：footerText 覆写版权行 / icpNumber 备案链接（beian.miit.gov.cn）/
 *     contactEmail·xUrl 覆写联系渠道；QQ 一键加群保留 config（邀请 key 群号不可推导）；
 *  D) 降级语义：loader 返回 null 或字段留空 → i18n/config 硬编码原样（与接入前一致）；
 *  E) 本测试已挂载 npm test。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ─────────────────────── A) generateMetadata ───────────────────────
test("site-wiring(A): generateMetadata 走 getSiteSettings + 字段级回退 i18n", () => {
  const l = read("src/app/[locale]/layout.tsx");
  assert.ok(l.includes('import { getSiteSettings } from "@/lib/cms/loaders"'), "引入 loader");
  assert.ok(l.includes("await getSiteSettings()"), "读取站点设置");
  assert.ok(l.includes('locale === "en" ? settings?.siteNameEn : settings?.siteNameZh'), "站点名按语言取值");
  assert.ok(l.includes('locale === "en" ? settings?.sloganEn : settings?.sloganZh'), "slogan 按语言取值");
  assert.ok(l.includes("${cmsName} - ${cmsSlogan}"), "CMS 双全时接管 <title>");
  assert.ok(l.includes('t("metaTitle")'), "回退 i18n metaTitle");
  assert.ok(l.includes('cmsSlogan ?? t("metaDescription")'), "description 回退 i18n");
  assert.ok(l.includes("icons: { icon: favicon }"), "faviconUrl 覆盖 icons");
  assert.ok(l.includes('cmsName ?? t("appName")'), "og:siteName 回退 i18n");
});

// ─────────────────────── B) SiteJsonLd ───────────────────────
test("site-wiring(B): SiteJsonLd 名称/描述/Logo 走 CMS（logo 缺省 /icon.svg）", () => {
  const l = read("src/app/[locale]/layout.tsx");
  assert.ok(l.includes('settings?.logoUrl?.trim() || "/icon.svg"'), "logoUrl 缺省回退 /icon.svg");
  assert.ok(l.includes("logoUrl={cmsLogo}"), "JsonLd 接收 CMS logo");
  assert.ok(l.includes('logoUrl.startsWith("http")'), "绝对/相对 URL 兼容");
  assert.ok(l.includes("description={cmsSlogan ??"), "JsonLd 描述走 slogan 回退 i18n");
});

// ─────────────────────── C) Footer ───────────────────────
test("site-wiring(C): Footer 版权行/备案/邮箱/X 走 CMS + 字段级回退", () => {
  const f = read("src/components/layout/Footer.tsx");
  assert.ok(f.includes('import { getSiteSettings } from "@/lib/cms/loaders"'), "引入 loader");
  assert.ok(f.includes("await getSiteSettings()"), "读取站点设置");
  assert.ok(f.includes("settings?.footerTextEn : settings?.footerTextZh"), "footerText 按语言覆写版权行");
  assert.ok(f.includes('t("copyrightLine")'), "版权行回退 i18n");
  assert.ok(f.includes("https://beian.miit.gov.cn"), "ICP 备案链接（工信部标准）");
  assert.ok(f.includes("settings?.icpNumber"), "icpNumber 有才显示");
  assert.ok(f.includes("mailto:${email}"), "contactEmail 覆写 mailto");
  assert.ok(f.includes("EMAIL_URL"), "邮箱回退 config EMAIL_URL");
  assert.ok(f.includes("CONTACT_INFO.xUrl"), "X 链接回退 config");
  // QQ 一键加群 joinUrl 含邀请 key（群号不可推导）→ 不覆写，保留 config 单一事实源
  assert.ok(f.includes("CONTACT_INFO.qqGroupJoinUrl"), "QQ 加群链接保留 config（邀请 key 不可入库推导）");
  const fc = read("src/components/layout/FooterCollapsible.tsx");
  assert.ok(fc.includes("copyrightExtra"), "折叠容器支持备案附加槽位");
});

// ─────────────────────── D) 降级语义不破坏 ───────────────────────
test("site-wiring(D): 降级链语义保留（cmsEnabled 闸 + 空值回退硬编码）", () => {
  const loaders = read("src/lib/cms/loaders.ts");
  assert.ok(loaders.includes('"site-settings"'), "site-settings loader（key=tag 同名）");
  assert.ok(loaders.includes("findGlobal({ slug: \"site-settings\""), "findGlobal site-settings");
  // layout 与 Footer 全部字段级空值回退（|| / ??），CMS 全空 = 接入前渲染完全一致
  const l = read("src/app/[locale]/layout.tsx");
  assert.ok((l.match(/\.trim\(\) \|\|/g) ?? []).length >= 3, "layout 字段级 trim 空值回退");
  const f = read("src/components/layout/Footer.tsx");
  assert.ok((f.match(/\.trim\(\) \|\|/g) ?? []).length >= 3, "Footer 字段级 trim 空值回退");
});

// ─────────────────────── E) 挂载 ───────────────────────
test("site-wiring(E): 本测试已挂载 npm test", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts.test.includes("payload-site-wiring.test.mjs"), "已挂载 npm test");
});
