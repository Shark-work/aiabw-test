import { setRequestLocale } from "next-intl/server";

import { SupplyClient } from "@/components/aibi/supply-client";

/**
 * /[locale]/supply
 * 总量看板（艾比平台 Phase 7 · 8.8，公开）：
 * 当前流通 / 累计增发 / 累计销毁 / 最大供应 + 快照趋势 + 增发销毁历史。
 */
export default async function SupplyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <SupplyClient />
    </main>
  );
}
