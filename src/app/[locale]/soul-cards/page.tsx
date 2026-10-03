import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CollectionClient } from "@/components/collection/collection-client";
import { ogShareFields, SITE_URL } from "@/lib/site";

/**
 * /[locale]/soul-cards
 * 收藏中心（2026-10-06 三 Tab 重构，CollectionClient）：
 *  - ?tab=aibi 艾比凭证（AibiSoulPanel，aibi_tokens，Phase 5 · 5.4）
 *  - ?tab=soul 灵魂卡（SoulCardsClient，soul_cards，Phase 1）
 *  - ?tab=nfr  数字藏品（NfrGalleryPanel，/api/gallery?mine=1 → user_collectibles）
 *
 * 登录门槛与 explore-v2 同策略：本站登录态只保存在 localStorage 的
 * aiabw_token（API 一律 Authorization: Bearer），cookie 中无令牌，
 * 因此鉴权与首屏数据全部移至客户端容器（CollectionClient）：
 * 仅确认无 token（或接口 401）时展示登录引导；链状态公开可读，无需登录。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations("seo");
  const title = t("soulCardsTitle");
  const description = t("soulCardsDesc").slice(0, 160);
  return {
    title,
    description,
    openGraph: { ...ogShareFields(locale), title, description, type: "website", url: `${SITE_URL}/${locale}/soul-cards` },
  };
}

export default async function SoulCardsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      {/* useSearchParams 需 Suspense 边界（Next 15 静态渲染约束） */}
      <Suspense fallback={null}>
        <CollectionClient />
      </Suspense>
    </main>
  );
}
