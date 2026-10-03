"use client";

/**
 * CollectionClient · /[locale]/soul-cards 收藏中心容器（2026-10-06 三 Tab 重构）
 *  - 三个 Tab：艾比凭证（AibiSoulPanel，aibi_tokens）/ 灵魂卡（SoulCardsClient，soul_cards）/
 *    数字藏品（NfrGalleryPanel，/api/gallery?mine=1 → user_collectibles）；
 *  - Tab 状态写入 URL query（?tab=aibi|soul|nfr，默认 aibi），便于分享直达与回退；
 *  - 两个旧面板组件原样复用，不改动其内部逻辑。
 */
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { usePathname, useRouter } from "@/i18n/navigation";
import { AibiSoulPanel } from "@/components/aibi/aibi-soul-panel";
import { SoulCardsClient } from "@/components/soul-card/soul-cards-client";
import { NfrGalleryPanel } from "@/components/collection/nfr-gallery-panel";

const TABS = ["aibi", "soul", "nfr"] as const;
type TabId = (typeof TABS)[number];

export function CollectionClient() {
  const t = useTranslations("collection");
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const raw = searchParams.get("tab") ?? "aibi";
  const tab: TabId = (TABS as readonly string[]).includes(raw) ? (raw as TabId) : "aibi";

  function switchTab(id: TabId) {
    router.replace(`${pathname}?tab=${id}`, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-black text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
      </header>

      <div role="tablist" aria-label={t("title")} className="flex flex-wrap gap-2">
        {TABS.map((id) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => switchTab(id)}
              className={
                active
                  ? "rounded-full bg-orange-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm"
                  : "rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-sm font-medium text-zinc-600 transition hover:border-orange-300 hover:text-orange-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              }
            >
              {t(`tabs.${id}`)}
            </button>
          );
        })}
      </div>

      {tab === "aibi" ? <AibiSoulPanel /> : null}
      {tab === "soul" ? <SoulCardsClient /> : null}
      {tab === "nfr" ? <NfrGalleryPanel /> : null}
    </div>
  );
}
