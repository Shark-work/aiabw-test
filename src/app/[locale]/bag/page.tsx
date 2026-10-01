import { setRequestLocale } from "next-intl/server";

import { BagClient } from "@/components/aibi/bag-client";

/**
 * /[locale]/bag
 * 背包页（艾比平台 Phase 5 · 5.3）：我的艾比 + 卡包 + 消耗品。
 * 登录态存于 localStorage（cookie 无令牌），鉴权与数据全部在客户端容器处理。
 */
export default async function BagPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <BagClient />
    </main>
  );
}
