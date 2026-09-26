import { getTranslations, setRequestLocale } from "next-intl/server";

import { PortraitClient } from "@/components/workshop/portrait-client";

// UGC 内容创作工坊 · AI 宠物写真工坊（[locale]/workshop/portrait）
//  - 上传照片 + 10 种风格 → /api/ugc/generate-portrait → 外部生图服务
export default async function PortraitPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "workshop" });

  return (
    <main className="min-h-screen bg-gradient-to-b from-violet-50/50 via-white to-fuchsia-50/40">
      <title>{`${t("portraitTitle")} | Huggy Fox`}</title>
      <PortraitClient />
    </main>
  );
}
