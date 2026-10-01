import { setRequestLocale } from "next-intl/server";

import { AibiPageClient } from "@/components/aibi/aibi-page-client";

/**
 * /[locale]/aibi/[tokenId]
 * 艾比详情页舞台（艾比平台 Phase 9 · AibiStagePage，公开可读）：
 * 左 形象大卡（五档动效）/ 中 详细信息面板 / 右 链上信息面板 / 底 互动时间线；
 * 持有者可见四动作互动按钮（feed/train/talk/play），非持有者只读；移动端单列降级。
 */
export default async function AibiPage({
  params,
}: {
  params: Promise<{ locale: string; tokenId: string }>;
}) {
  const { locale, tokenId } = await params;
  setRequestLocale(locale);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <AibiPageClient tokenId={tokenId} />
    </main>
  );
}
