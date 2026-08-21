import type { Metadata } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import "@/app/globals.css";

import { Footer } from "@/components/layout/Footer";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { FloatingSupport } from "@/components/layout/FloatingSupport";
import { routing } from "@/i18n/routing";

// 本应用强依赖数据库 / Cookie / 请求上下文（认证、支付、Neon），
// 禁用静态预渲染，统一走动态渲染（Vercel 按请求渲染，避免 next-intl 静态上下文报错）。
export const dynamic = "force-dynamic";

/** 静态导出/增量渲染：为每个语言生成一次 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
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

  return (
    <html lang={locale}>
      <body className="antialiased bg-zinc-50 flex min-h-screen flex-col">
        {/* locale 必须显式传入：next-intl v4 客户端 bundle 在 hydration 时若缺失 locale 会直接
            throw Error（线上曾因此报 “Application error: a client-side exception”）。 */}
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* 全局固定顶部导航（所有页面可见，移动端折叠为汉堡菜单） */}
          <SiteHeader />
          {/* 右下角悬浮客服按钮（/chat 页自动隐藏） */}
          <FloatingSupport />
          <div className="flex flex-1 flex-col">{children}</div>
          {/* Footer（含 LanguageSwitcher）与 Analytics 必须在 Provider 内部：
              否则 LanguageSwitcher 的 useLocale() 找不到 intl 上下文，全站渲染崩溃。 */}
          <Footer />
          <Analytics />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
