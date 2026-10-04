"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { CompanionPanel } from "@/components/pets/companion-panel";
import { CollectionPanel } from "@/components/pets/collection-panel";

type TabKey = "companion" | "collection";

/**
 * 我的灵宠（/pets/my）—— 双页合并后的统一入口（2026-10-09，backlog P2）。
 *  - 💞 伙伴 Tab：聊天宠物视角（心情/记忆/背包/装扮/邀请），原 /my-pets 全部能力；
 *  - 🎒 收藏 Tab：宠物资产视角（持有管理/融合/兑换/放生），原 /pets/my 全部能力。
 * 旧 URL /my-pets 已 308 至本页（src/app/[locale]/my-pets/page.tsx）。
 * 深链：?tab=collection 直达收藏；?rarity=（图鉴下线的稀有度筛选历史入口）自动切收藏。
 * 面板懒挂载：首次切到才挂载（避免双份首屏请求），挂载后隐藏保留状态（来回切换不丢数据）。
 */
export default function MySoulPetsPage() {
  const tm = useTranslations("myPets");
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("companion");
  const [visited, setVisited] = useState<ReadonlySet<TabKey>>(
    () => new Set<TabKey>(["companion"]),
  );

  const switchTab = (next: TabKey) => {
    setTab(next);
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  };

  // 未登录 → 登录后回跳本页（原 /pets/my 行为，合并后由壳层统一承担）
  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem("aiabw_token")) {
      router.push("/login?redirect=/pets/my");
    }
  }, [router]);

  // 深链：?tab=collection 或 ?rarity=（图鉴稀有度筛选历史深链）→ 收藏 Tab
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("tab") === "collection" || qs.get("rarity")) switchTab("collection");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabBtn = (key: TabKey, label: string) => (
    <button
      key={key}
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => switchTab(key)}
      className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
        tab === key
          ? "bg-violet-500 text-white shadow-sm"
          : "border border-zinc-200 bg-white text-zinc-600 hover:border-violet-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 pb-28 sm:p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">{tm("title")}</h1>
            <p className="mt-0.5 text-xs text-zinc-500">{tm("subtitle")}</p>
          </div>
          <div className="flex items-center gap-2" role="tablist">
            {tabBtn("companion", tm("tabCompanion"))}
            {tabBtn("collection", tm("tabCollection"))}
          </div>
        </div>

        {/* 懒挂载 + 状态保留：切走仅隐藏，切回不重新请求 */}
        {visited.has("companion") && (
          <div className={tab === "companion" ? undefined : "hidden"}>
            <CompanionPanel />
          </div>
        )}
        {visited.has("collection") && (
          <div className={tab === "collection" ? undefined : "hidden"}>
            <CollectionPanel />
          </div>
        )}
      </div>
    </main>
  );
}
