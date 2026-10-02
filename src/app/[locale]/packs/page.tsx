import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PacksClient } from "@/components/aibi/packs-client";
import { SITE_URL } from "@/lib/site";

/**
 * /[locale]/packs
 * 卡包商店（艾比平台 Phase 5 · 5.1）。
 * 登录态存于 localStorage（cookie 无令牌），鉴权与数据全部在客户端容器处理。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations("seo");
  const title = t("packsTitle");
  const description = t("packsDesc").slice(0, 160);
  return {
    title,
    description,
    openGraph: { title, description, type: "website", url: `${SITE_URL}/${locale}/packs` },
  };
}

export default async function PacksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <PacksClient />
    </main>
  );
}
