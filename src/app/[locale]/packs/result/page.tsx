import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";

import { PackResultClient } from "@/components/aibi/pack-result-client";

/**
 * /[locale]/packs/result?packId=xx
 * 开包结果页（艾比平台 Phase 5 · 5.2）：
 * 购买成功或从背包点「开包」后进入，客户端先调 /api/pack/open 再播放动画。
 * useSearchParams 需 Suspense 边界（Next 15 CSR bailout 要求）。
 */
export default async function PackResultPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Suspense fallback={<div className="h-80 animate-pulse rounded-3xl bg-zinc-100 dark:bg-zinc-800" />}>
        <PackResultClient />
      </Suspense>
    </main>
  );
}
