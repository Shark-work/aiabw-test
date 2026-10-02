import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AibiSoulPanel } from "@/components/aibi/aibi-soul-panel";
import { SoulCardsClient } from "@/components/soul-card/soul-cards-client";
import { ogShareFields, SITE_URL } from "@/lib/site";

/**
 * /[locale]/soul-cards
 * 灵魂卡图鉴页：艾比平台板块（Phase 5 · 5.4，AibiSoulPanel）
 * + V1 宠物灵魂卡板块（平台升级 Phase 1，SoulCardsClient）。
 *
 * 登录门槛与 explore-v2 同策略：本站登录态只保存在 localStorage 的
 * aiabw_token（API 一律 Authorization: Bearer），cookie 中无令牌，
 * 因此鉴权与首屏数据全部移至客户端容器（SoulCardsClient）：
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
    <main className="mx-auto max-w-5xl space-y-10 px-4 py-6">
      {/* 艾比平台板块（Phase 5 · 5.4）：供应看板 / 我的持有 / 可铸列表 / 详情互动 */}
      <AibiSoulPanel />
      {/* V1 宠物灵魂卡板块（Phase 1 保留） */}
      <SoulCardsClient />
    </main>
  );
}
