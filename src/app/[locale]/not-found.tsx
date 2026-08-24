"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

/**
 * 404 页面（/zh/not-found 与 /en/not-found 均走此组件）。
 * 使用 client useTranslations：not-found 上下文无 request locale，
 * server 版 getTranslations 会失败回退到默认 404，故走 Provider 内上下文。
 */
export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-4xl font-bold text-zinc-900">404</h1>
      <p className="text-sm text-zinc-500">{t("desc")}</p>
      <Link
        href="/"
        className="rounded-full bg-orange-500 px-5 py-2 text-sm font-semibold text-white shadow transition hover:bg-orange-600"
      >
        {t("backHome")}
      </Link>
    </main>
  );
}

