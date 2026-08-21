import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { SupportContact } from "@/components/layout/SupportContact";

export default async function LegalGoodsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("legal");
  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-6 sm:px-6">
      <article className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white/90 p-5 shadow-sm backdrop-blur sm:p-8">
        <h1 className="text-xl font-bold text-zinc-900">{t("goodsTitle")}</h1>
        <p className="mt-1 text-xs text-zinc-400">{t("lastUpdated")}</p>
        <div className="mt-4 whitespace-pre-line text-sm leading-relaxed text-zinc-600">
          {t("goodsBody")}
        </div>
        {/* 意见反馈与客服联系 */}
        <SupportContact />
        <Link
          href="/"
          className="mt-5 inline-block text-sm font-medium text-orange-600 hover:underline"
        >
          {t("backHome")}
        </Link>
      </article>
    </main>
  );
}
