import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ShopClient } from "@/components/aibi/shop-client";
import { ogShareFields, SITE_URL } from "@/lib/site";

/**
 * /[locale]/shop
 * 道具商店（艾比平台 Phase 6 · 6.3）：道具列表 + 积分购买。
 * 道具目录为公开接口；登录态存于 localStorage，购买鉴权在客户端容器处理。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations("seo");
  const title = t("shopTitle");
  const description = t("shopDesc").slice(0, 160);
  return {
    title,
    description,
    openGraph: { ...ogShareFields(locale), title, description, type: "website", url: `${SITE_URL}/${locale}/shop` },
  };
}

export default async function ShopPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <ShopClient />
    </main>
  );
}
