import { setRequestLocale } from "next-intl/server";

import { CodexClient } from "@/components/aibi/codex-client";

/**
 * /[locale]/codex
 * 艾比图鉴页（艾比平台 Phase 7 · 8.2）：全部物种 + 稀有度/元素/栖息地筛选 + 拥有状态。
 */
export default async function CodexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <CodexClient />
    </main>
  );
}
