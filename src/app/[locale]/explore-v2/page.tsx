import { setRequestLocale } from "next-intl/server";

import { ExploreV2Panel } from "@/components/exploration-v2/explore-v2-panel";

/**
 * /[locale]/explore-v2
 * 探索 v2 主页。
 *
 * 修复（2026-09，"已登录仍提示请先登录"）：本站登录态只保存在 localStorage
 * 的 aiabw_token（API 一律 Authorization: Bearer），cookie 中并不存在令牌，
 * 旧版在此用 cookie 做 SSR 鉴权 → 已登录用户也永远命中「请先登录」。
 * 因此登录门槛与首屏数据（配额 / 历史记录）移至客户端面板：挂载时读
 * localStorage → Bearer 拉取 /api/exploration/quota 与 /api/exploration/history；
 * 仅确认无 token（或接口 401）时才展示登录引导。
 */
export default async function ExploreV2Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <ExploreV2Panel />
    </main>
  );
}
