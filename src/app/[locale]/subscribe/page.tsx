import { getTranslations, setRequestLocale } from "next-intl/server";

import { SubscribeClient } from "@/components/subscription/subscribe-client";

// 宠物旅行日记 · VIP 订阅页（[locale]/subscribe）
//  - 服务端不做权限检查；客户端 useEffect 自取 /api/subscription/plans（含 current）
export default async function SubscribePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "subscription" });

  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50/40 via-white to-pink-50/30">
      <title>{t("title")} | Huggy Fox</title>
      <SubscribeClient />
    </main>
  );
}
