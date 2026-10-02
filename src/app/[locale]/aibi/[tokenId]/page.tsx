import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AibiPageClient } from "@/components/aibi/aibi-page-client";
import { SITE_URL } from "@/lib/site";

/**
 * /[locale]/aibi/[tokenId]
 * 艾比详情页舞台（艾比平台 Phase 9 · AibiStagePage，公开可读）：
 * 左 形象大卡（五档动效）/ 中 详细信息面板 / 右 链上信息面板 / 底 互动时间线；
 * 持有者可见四动作互动按钮（feed/train/talk/play），非持有者只读；移动端单列降级。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; tokenId: string }>;
}): Promise<Metadata> {
  const { locale, tokenId } = await params;
  const t = await getTranslations("seo");
  // 截断防注入：tokenId 直接进入 title/description（形如 AIBI-000039，正常仅 11 字符）
  const safeId = tokenId.slice(0, 32);
  const title = t("aibiTitle", { tokenId: safeId });
  const description = t("aibiDesc", { tokenId: safeId }).slice(0, 160);
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `${SITE_URL}/${locale}/aibi/${encodeURIComponent(safeId)}`,
    },
  };
}

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
