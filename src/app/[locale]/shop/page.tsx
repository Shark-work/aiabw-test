import { setRequestLocale } from "next-intl/server";

import { ShopClient } from "@/components/aibi/shop-client";

/**
 * /[locale]/shop
 * 道具商店（艾比平台 Phase 6 · 6.3）：道具列表 + 积分购买。
 * 道具目录为公开接口；登录态存于 localStorage，购买鉴权在客户端容器处理。
 */
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
