"use client";

/**
 * 灵魂卡「我的收藏进度」统计面板（Phase 7 · 7.4-2）：
 *  - 纯前端推导（cards 数组已在客户端），无额外请求；
 *  - 三段：总量/最高等级/已销毁 → 稀有度分布 stacked bar（仅计流通中）→ 四元素收集点亮；
 *  - 视觉复用 RARITY_META.badgeClass / ELEMENT_META.emoji，与卡面徽章同色系。
 */

import { useTranslations } from "next-intl";

import {
  ELEMENT_META,
  RARITY_META,
  SOUL_CARD_ELEMENTS,
  SOUL_CARD_RARITIES,
  normalizeElement,
  normalizeRarity,
} from "@/lib/soul-card-config";
import type { SoulCardDto } from "./soul-card-types";

export function CollectionProgress({
  cards,
  locale,
}: {
  cards: SoulCardDto[];
  locale: string;
}) {
  const t = useTranslations("soulCards.progress");
  const isEn = locale === "en";

  const active = cards.filter((c) => c.status !== "burned");
  const burnedCount = cards.length - active.length;
  const maxLevel = cards.reduce((m, c) => Math.max(m, c.growthLevel), 0);

  // 稀有度分布（仅流通中；保证 5 档顺序 legendary → common 由右至左堆叠，稀有档更醒目）
  const rarityCounts = SOUL_CARD_RARITIES.map((r) => ({
    rarity: r,
    count: active.filter((c) => normalizeRarity(c.rarity) === r).length,
  }));
  const collectedElements = new Set(active.map((c) => normalizeElement(c.element)));

  return (
    <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white/85 p-4 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/70">
      {/* 顶部统计行 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
        <span>
          {t("total", { count: cards.length })}
          {burnedCount > 0 ? (
            <span className="ml-1 text-zinc-400">{t("burnedNote", { count: burnedCount })}</span>
          ) : null}
        </span>
        <span>{t("maxLevel", { level: maxLevel })}</span>
        <span>
          {t("elementsDone", { count: collectedElements.size, total: SOUL_CARD_ELEMENTS.length })}
        </span>
      </div>

      {/* 稀有度分布 stacked bar（流通中；空收藏不渲染条） */}
      {active.length > 0 ? (
        <div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            {rarityCounts.map(({ rarity, count }) =>
              count > 0 ? (
                <span
                  key={rarity}
                  className={`h-full ${RARITY_META[rarity].badgeClass.split(" ")[0]}`}
                  style={{ width: `${(count / active.length) * 100}%` }}
                  title={`${isEn ? RARITY_META[rarity].labelEn : RARITY_META[rarity].labelZh} ×${count}`}
                />
              ) : null,
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {rarityCounts.map(({ rarity, count }) =>
              count > 0 ? (
                <span key={rarity} className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  {RARITY_META[rarity].emoji}
                  {isEn ? RARITY_META[rarity].labelEn : RARITY_META[rarity].labelZh} ×{count}
                </span>
              ) : null,
            )}
          </div>
        </div>
      ) : null}

      {/* 四元素收集点亮 */}
      <div className="flex items-center gap-3">
        {SOUL_CARD_ELEMENTS.map((el) => {
          const got = collectedElements.has(el);
          const meta = ELEMENT_META[el];
          return (
            <span
              key={el}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                got
                  ? "bg-orange-50 font-medium text-zinc-700 dark:bg-orange-950/30 dark:text-zinc-200"
                  : "bg-zinc-100 text-zinc-400 grayscale dark:bg-zinc-800"
              }`}
              title={isEn ? meta.labelEn : meta.labelZh}
            >
              {meta.emoji} {isEn ? meta.labelEn : meta.labelZh}
            </span>
          );
        })}
      </div>
    </section>
  );
}
