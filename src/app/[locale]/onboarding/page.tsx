import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

/**
 * /[locale]/onboarding — 新手引导「唤醒仪式」（P1 故事外显）
 * 三步流程：遇见 → 唤醒 → 启程（OnboardingWizard 客户端组件）。
 * 登录门槛与其他页同策略：登录态只存 localStorage aiabw_token，
 * SSR 读不到 → 鉴权与状态判定全部在客户端完成（无 token 引导登录后回跳）。
 * noindex：流程页不对外分享、不收录。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  // 路由参数就绪即可（next-intl getTranslations 内部按请求 locale 解析）
  await params;
  const t = await getTranslations("onboarding");
  return {
    title: t("metaTitle"),
    robots: { index: false, follow: false },
  };
}

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <OnboardingWizard />
    </main>
  );
}
