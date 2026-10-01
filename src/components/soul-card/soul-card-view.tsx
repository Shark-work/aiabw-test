"use client";

/**
 * 灵魂卡卡面（列表/详情共用）：
 * 稀有度渐变边框 + 立绘 + 名称 + 元素/稀有度徽章 + 凭证编号 + 成长阶段；
 * 已销毁卡置灰并叠加「已销毁」标记。纯展示组件，不含数据获取。
 */

import {
  ELEMENT_META,
  RARITY_META,
  normalizeElement,
  normalizeRarity,
  stageForLevel,
} from "@/lib/soul-card-config";
import type { SoulCardDto } from "./soul-card-types";

export function SoulCardView({
  card,
  locale,
  onClick,
}: {
  card: SoulCardDto;
  locale: string;
  onClick?: () => void;
}) {
  const rarity = normalizeRarity(card.rarity);
  const element = normalizeElement(card.element);
  const rarityMeta = RARITY_META[rarity];
  const elementMeta = ELEMENT_META[element];
  const stage = stageForLevel(card.growthLevel);
  const isEn = locale === "en";
  const burned = card.status === "burned";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full rounded-2xl bg-gradient-to-br p-[3px] text-left shadow-sm transition hover:shadow-md ${rarityMeta.frameClass}`}
    >
      <div className="relative overflow-hidden rounded-[13px] bg-white dark:bg-zinc-900">
        {/* 立绘 */}
        <div className="relative aspect-square w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.petImageUrl}
            alt={card.name}
            className={`h-full w-full object-cover transition group-hover:scale-105 ${burned ? "opacity-40 grayscale" : ""}`}
            loading="lazy"
          />
          {burned ? (
            <span className="absolute inset-0 flex items-center justify-center text-4xl">
              🔥
            </span>
          ) : null}
          {/* 稀有度徽章 */}
          <span
            className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${rarityMeta.badgeClass}`}
          >
            {rarityMeta.emoji} {isEn ? rarityMeta.labelEn : rarityMeta.labelZh}
          </span>
          {/* 元素徽章 */}
          <span className="absolute right-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-semibold text-white">
            {elementMeta.emoji} {isEn ? elementMeta.labelEn : elementMeta.labelZh}
          </span>
        </div>

        {/* 卡面信息 */}
        <div className="space-y-1.5 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {card.name}
            </span>
            <span className="shrink-0 text-xs" title={isEn ? stage.labelEn : stage.labelZh}>
              {stage.emoji} Lv.{card.growthLevel}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
              {card.certificateNo}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-zinc-400">
              #{card.tokenId}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
