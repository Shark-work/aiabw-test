import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

/**
 * 兜底 404：捕获 [locale] 下所有未知路径（/zh/xxx、/en/xxx）。
 * 用 server getTranslations（正常路由上下文，必有 request locale），
 * 避免依赖 not-found 机制（Next 15.5 + next-intl 下可能回退默认 _error）。
 */
export default async function CatchAllNotFound() {
  const t = await getTranslations("notFound");
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
