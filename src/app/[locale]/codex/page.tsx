import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CodexClient } from "@/components/aibi/codex-client";
import { SITE_URL } from "@/lib/site";

/**
 * /[locale]/codex
 * 艾比图鉴页（艾比平台 Phase 7 · 8.2）：全部物种 + 稀有度/元素/栖息地筛选 + 拥有状态。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations("seo");
  const title = t("codexTitle");
  const description = t("codexDesc").slice(0, 160);
  return {
    title,
    description,
    openGraph: { title, description, type: "website", url: `${SITE_URL}/${locale}/codex` },
  };
}

export default async function CodexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <CodexClient />
    </main>
  );
}
