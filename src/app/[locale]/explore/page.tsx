import { permanentRedirect } from "next/navigation";

/**
 * /[locale]/explore → /[locale]/explore-v2（308 永久重定向）
 *
 * 背景（V1→V2 迁移 P0，见 .clinerules/roadmap.md 三，2026-09-23 核实）：
 * 旧版 V1 探索是「聊天驱动挂机探索」，从未有过独立页面（真实入口是聊天页
 * 的 ExplorationMap 挂件），/explore 在 git 历史中不存在。此处兜底兼容
 * 旧书签 / 外部链接 / 未来误链，统一引导到 V2 主页。
 * URL 兼容链路：/explore 经 middleware 自动补 locale 前缀（→ /zh/explore），
 * 再由本页 308 → /zh/explore-v2。
 */
export default async function ExplorePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/explore-v2`);
}
