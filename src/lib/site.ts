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
