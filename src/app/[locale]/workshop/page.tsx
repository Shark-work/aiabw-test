import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";

// UGC 内容创作工坊 · 聚合页（[locale]/workshop）
//  - 已上线模块：日记卡片 / AI 写真（卡片可点击进入）
//  - 未上线模块：表情包工坊 / 征集活动（置灰 + coming soon 角标）
type Module = {
  key: string;
  emoji: string;
  href?: string;
  gradient: string;
};

const MODULES: Module[] = [
  { key: "diaryCard", emoji: "📔", href: "/workshop/diary-card", gradient: "from-emerald-50 to-teal-100" },
  { key: "portrait", emoji: "📸", href: "/workshop/portrait", gradient: "from-violet-50 to-fuchsia-100" },
  { key: "sticker", emoji: "😆", gradient: "from-amber-50 to-orange-100" },
  { key: "campaign", emoji: "🏆", gradient: "from-sky-50 to-indigo-100" },
];

export default async function WorkshopPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "workshop" });

  return (
    <main className="min-h-screen bg-gradient-to-b from-violet-50/50 via-white to-amber-50/40">
      <title>{t("title")} | Huggy Fox</title>
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
            🎨 {t("title")}
          </h1>
          <p className="mt-2 text-sm text-zinc-500">{t("subtitle")}</p>
        </header>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {MODULES.map((m) => {
            const live = !!m.href;
            const body = (
              <div
                className={`relative flex h-full items-start gap-4 rounded-2xl border border-zinc-200 bg-gradient-to-br p-5 shadow-sm transition ${
                  m.gradient
                } ${live ? "hover:-translate-y-0.5 hover:shadow-md" : "opacity-70"}`}
              >
                <span className="text-4xl" aria-hidden>
                  {m.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-zinc-900">
                    {t(`${m.key}Title`)}
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-600">
                    {t(`${m.key}Desc`)}
                  </p>
                  <span
                    className={`mt-3 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                      live
                        ? "bg-zinc-900 text-white"
                        : "bg-zinc-200 text-zinc-500"
                    }`}
                  >
                    {live ? `→ ${t("enter")}` : `⏳ ${t("comingSoon")}`}
                  </span>
                </div>
              </div>
            );
            return live ? (
              <Link key={m.key} href={m.href!} className="block">
                {body}
              </Link>
            ) : (
              <div key={m.key} aria-disabled>
                {body}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
