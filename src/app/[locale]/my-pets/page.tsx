import { permanentRedirect } from "next/navigation";

/**
 * /[locale]/my-pets → /[locale]/pets/my（308 永久重定向）
 *
 * 背景（2026-10-09 双页合并，backlog P2 完成）：原 /my-pets（聊天伙伴视角：
 * 心情/记忆/背包/装扮/邀请）与 /pets/my（收藏资产视角：持有管理/融合/兑换）
 * 数据源同为 adoptions、职责割裂，用户需在两个「我的宠物」间来回。已合并为
 * /pets/my 单页双 Tab（伙伴/收藏，src/components/pets/{companion,collection}-panel.tsx），
 * 本页保留 308 兼容旧书签 / 外链 / 搜索引擎历史收录（与 /explore → /explore-v2 同模式）。
 */
export default async function MyPetsRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/pets/my`);
}
