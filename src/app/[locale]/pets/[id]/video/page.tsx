import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PetVideoClient } from "@/components/pet-video-client";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "petVideo" });
  return { title: t("title"), robots: { index: false } };
}

/**
 * 灵宠日常短视频页（/pets/:id/video，id = adoptions.id；Phase 10）
 *  - 与 /pets/[id] 物种 SEO 页共存（不同 URL 深度），本页为用户私有功能页（noindex）；
 *  - SSR 壳 + 客户端状态机（idle → generating 轮询 → done/failed），见 pet-video-client。
 */
export default async function PetVideoPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <PetVideoClient petId={id} />;
}
