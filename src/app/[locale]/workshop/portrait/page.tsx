import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { PortraitClient } from "@/components/workshop/portrait-client";

// UGC 内容创作工坊 · AI 宠物写真工坊（[locale]/workshop/portrait）
//  - 上传照片 + 10 种风格 → /api/ugc/generate-portrait → 外部生图服务
//  - 外部生图服务（UGC_PORTRAIT_API_URL）未配置时整页降级为「敬请期待」
//    （直达 URL 兜底；聚合页入口同步置灰，配置后重新部署自动恢复）
export default async function PortraitPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "workshop" });

  if (!process.env.UGC_PORTRAIT_API_URL?.trim()) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-violet-50/50 via-white to-fuchsia-50/40 px-4">
        <title>{`${t("portraitTitle")} | Huggy Fox`}</title>
        <div className="rounded-2xl border border-zinc-200 bg-white/80 p-8 text-center shadow-sm">
          <p className="text-4xl" aria-hidden>
            📸
          </p>
          <h1 className="mt-3 text-lg font-bold text-zinc-900">{t("portraitTitle")}</h1>
          <p className="mt-2 text-sm text-zinc-500">⏳ {t("comingSoon")}</p>
          <Link
            href="/workshop"
            className="mt-5 inline-block rounded-full bg-violet-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-violet-600"
          >
            ← {t("title")}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-violet-50/50 via-white to-fuchsia-50/40">
      <title>{`${t("portraitTitle")} | Huggy Fox`}</title>
      <PortraitClient />
    </main>
  );
}
