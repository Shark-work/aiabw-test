import { setRequestLocale } from "next-intl/server";

import { MemoriesClient } from "./memories-client";

/**
 * /[locale]/memories —— 纯壳（鉴权模式对齐 de6453d / explore-v2 修复）
 *
 * 本站登录态只存 localStorage(aiabw_token)，API 一律 Bearer，全站从不写 cookie；
 * SSR 从 cookie 读 token 恒为 null（旧实现因此对所有用户显示「请先登录」）。
 * 故鉴权与数据加载全部下沉到 MemoriesClient：
 *  - 挂载时读 localStorage token → Bearer 拉 /api/memories
 *  - 无 token / 401 → 客户端重定向 /{locale}/login?redirect=/{locale}/memories
 *  - 403 VIP_REQUIRED → 订阅引导
 */
export default async function MemoriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <MemoriesClient />;
}

