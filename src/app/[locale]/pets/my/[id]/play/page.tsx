import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PetPlayClient } from "@/components/pet-play/pet-play-client";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "petPlay" });
  return { title: t("title"), robots: { index: false } };
}

/**
 * AI 宠物互动页（/pets/my/:id/play，id = adoptions.id）。
 *  - 全屏深色（#121212）电影沉浸舞台：Rive 状态机动画（资产缺席降级 CSS 动画立绘）、
 *    打字机字幕、右缘悬浮背包、底部对话输入；
 *  - 用户私有功能页（noindex）；SSR 壳 + 客户端状态机（见 pet-play-client）；
 *  - 防抄袭：对话/扣费/数值全部服务端化（/api/pet/chat|play|asset），.riv 资产经鉴权流式下发。
 */
export default async function PetPlayPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <PetPlayClient adoptionId={id} />;
}
