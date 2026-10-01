import { setRequestLocale } from "next-intl/server";

import { PacksClient } from "@/components/aibi/packs-client";

/**
 * /[locale]/packs
 * 卡包商店（艾比平台 Phase 5 · 5.1）。
 * 登录态存于 localStorage（cookie 无令牌），鉴权与数据全部在客户端容器处理。
 */
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
