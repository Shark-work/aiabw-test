import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PetMovieClient } from "@/components/pet-movie/pet-movie-client";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "petMovie" });
  // 用户私有互动页（宠物状态按人不同）：不索引
  return { title: t("title"), robots: { index: false } };
}

/**
 * 电影式 AI 宠物互动页（/pet-movie，经 middleware 自动补 locale 前缀）。
 *  - 与主站一致的 Header/Footer（[locale]/layout.tsx 全局自带）；舞台区深色电影沉浸容器；
 *  - Rive 状态机舞台（资产缺席降级 CSS 动画立绘）、打字机字幕、右缘 5% 热区滑出侧栏
 *    （猫粮/玩具一键互动）、底部对话输入；
 *  - 防抄袭：对话/扣费/数值全部服务端化（/api/pet/chat mode=movie、/api/pet/feed、
 *    /api/pet/movie），.riv 资产经 /api/pet/asset 鉴权 + Referer 校验 + 流式下发。
 */
export default async function PetMoviePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PetMovieClient />;
}
