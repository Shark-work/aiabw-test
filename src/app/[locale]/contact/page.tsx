import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pages");
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white/90 p-6 shadow-sm">
        <h1 className="text-xl font-bold text-zinc-900">{t("contactTitle")}</h1>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-zinc-600">
          {t("contactBody")}
        </p>
        <Link
          href="/"
          className="mt-5 inline-block text-sm font-medium text-orange-600 hover:underline"
        >
          {t("backHome")}
        </Link>
      </div>
    </main>
  );
}
