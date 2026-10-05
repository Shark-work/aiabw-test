/** 站点全局 URL 与国际化 SEO 工具。 */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.aiabw.com").replace(/\/+$/, "");

export const LOCALES = ["zh", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** 语言原生名（首字母大写，不用国旗——一种语言可能对应多个国家）。 */
export const LOCALE_LABELS: Record<string, string> = {
  zh: "中文",
  en: "English",
};

/** 归一化路径：去掉尾部斜杠（首页 "/" 除外）。 */
function cleanPath(pathname: string): string {
  const p = pathname === "/" ? "" : pathname.replace(/\/+$/, "");
  return p;
}

/**
 * 生成 per-page SEO alternates：
 *  - canonical：当前语言版本自引用 URL；
 *  - languages：zh/en 双向对称 hreflang + x-default 兜底（未匹配语言用户）。
 */
export function getAlternates(pathname: string, locale: string) {
  const p = cleanPath(pathname);
  return {
    canonical: `${SITE_URL}/${locale}${p}`,
    languages: {
      zh: `${SITE_URL}/zh${p}`,
      en: `${SITE_URL}/en${p}`,
      "x-default": `${SITE_URL}/zh${p}`,
    },
  };
}

/** 剥离语言前缀，返回无 locale 的路径（如 /zh/pets?x=1 → /pets?x=1）。 */
export function stripLocalePrefix(rawPathname: string): string {
  const m = rawPathname.match(/^\/(zh|en)(\/.*)?$/);
  if (m) return m[2] && m[2] !== "/" ? m[2] : "/";
  return rawPathname;
}

/** 全站 OG/Twitter 分享图 alt（1200×630，由 [locale]/opengraph-image 约定路由渲染）。 */
export const OG_SHARE_ALT = "艾比世界 · AI 灵魂养成与数字凭证平台";

/**
 * 页面级 openGraph 公共字段（siteName/locale/images）。
 * 注意：Next.js 对 openGraph 是浅合并——页面 generateMetadata 一旦导出 openGraph 对象，
 * layout 的 siteName/locale 与 opengraph-image 约定文件注入的 images 会被整体覆盖丢失，
 * 因此页面级 openGraph 必须显式展开本字段。
 */
export function ogShareFields(locale: string) {
  return {
    siteName: locale === "en" ? "AIABW" : "艾比世界",
    locale,
    images: [{ url: `${SITE_URL}/${locale}/opengraph-image`, width: 1200, height: 630, alt: OG_SHARE_ALT }],
  };
}
