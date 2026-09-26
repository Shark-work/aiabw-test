import { getTranslations, setRequestLocale } from "next-intl/server";

import { DiaryCardClient } from "@/components/workshop/diary-card-client";

// UGC 内容创作工坊 · 宠物日记卡片生成器（[locale]/workshop/diary-card）
//  - 纯前端 Canvas 合成，零后端成本；数据取自 /api/pets + /api/exploration/history
export default async function DiaryCardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "workshop" });

  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50/50 via-white to-teal-50/40">
      <title>{`${t("diaryCardTitle")} | Huggy Fox`}</title>
      <DiaryCardClient />
    </main>
  );
}
