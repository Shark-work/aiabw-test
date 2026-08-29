import type { Metadata } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import "@/app/globals.css";

import { Footer } from "@/components/layout/Footer";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { FloatingSupport } from "@/components/layout/FloatingSupport";
import { SidebarAnimalNews } from "@/components/sidebar-animal-news";
import { ThemeProvider } from "@/components/theme-provider";
import { routing } from "@/i18n/routing";
import { SITE_URL, getAlternates } from "@/lib/site";

// 本应用强依赖数据库 / Cookie / 请求上下文（认证、支付、Neon），
// 禁用静态预渲染，统一走动态渲染（Vercel 按请求渲染，避免 next-intl 静态上下文报错）。
export const dynamic = "force-dynamic";

/** 静态导出/增量渲染：为每个语言生成一次 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations("common");
  // middleware 注入的无前缀路径（如 /pets），用于 per-page canonical + hreflang
  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/";
  return {
    metadataBase: new URL(SITE_URL),
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: getAlternates(pathname, locale),
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      locale,
      siteName: t("appName"),
      title: t("metaTitle"),
      description: t("metaDescription"),
      url: `${SITE_URL}/${locale}${pathname === "/" ? "" : pathname}`,
    },
  };
}

/** 全局 WebSite + Organization 结构化数据（GEO：供 AI 引擎抓取品牌与内容概貌）。 */
function SiteJsonLd({ locale, name, description }: { locale: string; name: string; description: string }) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name,
    alternateName: "艾比世界",
    url: `${SITE_URL}/${locale}`,
    inLanguage: locale,
    description,
    publisher: {
      "@type": "Organization",
      name: "艾比世界 AIABW",
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/icon.svg`,
      },
    },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
    />
  );
}

/**
 * 全局根布局（位于 [locale] 动态段，是 next-intl 官方模式）：
 *  - 动态设置 <html lang={locale}>；
 *  - NextIntlClientProvider 提供客户端翻译上下文；
 *  - 全局 Footer + Analytics。
 */
export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const messages = (await import(`../../../messages/${locale}.json`)).default;
  const t = await getTranslations("common");

  return (
    <html lang={locale}>
      <head>
        {/* 主题防闪烁：首帧渲染前读取 localStorage 设置 data-theme（杜绝 FOUC） */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem("aiabw_theme")==="wild"){document.documentElement.setAttribute("data-theme","wild");}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased flex min-h-screen flex-col">
        {/* 全局结构化数据（WebSite + Organization，GEO 优化） */}
        <SiteJsonLd locale={locale} name={t("appName")} description={t("metaDescription")} />
        {/* locale 必须显式传入：next-intl v4 客户端 bundle 在 hydration 时若缺失 locale 会直接
            throw Error（线上曾因此报 “Application error: a client-side exception”）。 */}
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* 主题（cute/wild 一键切换，localStorage 持久化 + head 内联脚本防闪烁） */}
          <ThemeProvider>
          {/* 全局固定顶部导航（所有页面可见，移动端折叠为汉堡菜单） */}
          <SiteHeader />
          {/* 右下角悬浮客服按钮（/chat 页自动隐藏） */}
          <FloatingSupport />
          {/* 内容 + 全局右侧边栏（任务二：PC ≥lg 显示新闻热榜，sticky 跟随滚动）；
              移动端 <lg 侧边栏隐藏，折叠到首页信息流（见 page.tsx） */}
          <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-4 sm:px-6 lg:flex-row lg:py-6">
            <div className="min-w-0 flex-1">{children}</div>
            <aside className="hidden w-72 shrink-0 lg:block">
              <div className="sticky top-20">
                <SidebarAnimalNews />
              </div>
            </aside>
          </div>
          {/* Footer（含 LanguageSwitcher）与 Analytics 必须在 Provider 内部：
              否则 LanguageSwitcher 的 useLocale() 找不到 intl 上下文，全站渲染崩溃。 */}
          <Footer />
          <Analytics />
          </ThemeProvider>
        </NextIntlClientProvider>

        {/* ============ 第三方统计（全站生效：根布局，所有页面自动加载）============
            - Google Analytics (gtag.js)：G-11LB54EX3D（紧跟 <head> 后的标准 gtag 初始化）
            - 百度统计：d97499256780667049488b3c8dd15ce6
            均使用 strategy="afterInteractive"：hydration 后异步加载，不阻塞首屏。
            注意：next/script 需放在 <body> 内（App Router 自动管理 <head>），
            且仅此一处定义，不会重复注入。 */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-11LB54EX3D"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-11LB54EX3D');
          `}
        </Script>
        <Script id="baidu-analytics" strategy="afterInteractive">
          {`
            var _hmt = _hmt || [];
            (function() {
              var hm = document.createElement("script");
              hm.src = "https://hm.baidu.com/hm.js?d97499256780667049488b3c8dd15ce6";
              var s = document.getElementsByTagName("script")[0];
              s.parentNode.insertBefore(hm, s);
            })();
          `}
        </Script>
      </body>
    </html>
  );
}
