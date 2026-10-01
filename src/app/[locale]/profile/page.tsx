import { setRequestLocale } from "next-intl/server";

import { ProfileClient } from "@/components/aibi/profile-client";

/**
 * /[locale]/profile
 * 用户中心（艾比平台 Phase 7 · 8.7）：账号/钱包/持有计数/铸造与销毁记录。
 * 登录态存于 localStorage（cookie 无令牌），鉴权与数据全部在客户端容器处理。
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <ProfileClient />
    </main>
  );
}
