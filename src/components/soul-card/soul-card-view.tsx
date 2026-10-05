"use client";

/**
 * 灵魂卡卡面（列表/详情共用）：
 * 稀有度渐变边框 + 立绘 + 名称 + 元素/稀有度徽章 + 凭证编号 + 成长阶段；
 * 已销毁卡置灰并叠加「已销毁」标记。纯展示组件，不含数据获取。
 *
 * P1 故事外显（2026-10-14）：卡面视觉随成长阶段（soul-card-config stageForLevel）变化——
 *  seed    沉睡形态：灰调立绘 + 💤 + 编号旁「沉睡中」标注；
 *  sprout  萌芽形态：绿色调面板 + 萌芽光晕；
 *  bloom   绽放形态：彩色渐变面板；
 *  radiant 光辉形态：金色光晕 + ✨ 光辉角标（稀有标识见详情弹窗）。
 */

import { useTranslations } from "next-intl";

import {
  ELEMENT_META,
  RARITY_META,
  normalizeElement,
  normalizeRarity,
  soulQuoteFor,
  stageForLevel,
  type GrowthStageId,
} from "@/lib/soul-card-config";
import type { SoulCardDto } from "./soul-card-types";

/** 阶段视觉映射（tailwind class；burned 置灰优先于阶段视觉）。 */
const STAGE_FX: Record<
  GrowthStageId,
  { img: string; panel: string; glow: string }
> = {
  seed: {
    img: "opacity-75 grayscale",
    panel: "bg-zinc-50 dark:bg-zinc-900",
    glow: "",
  },
  sprout: {
    img: "",
    panel: "bg-emerald-50/70 dark:bg-emerald-950/20",
    glow: "ring-2 ring-emerald-300/70",
  },
  bloom: {
    img: "",
    panel:
      "bg-gradient-to-br from-violet-50 to-rose-50 dark:from-violet-950/30 dark:to-rose-950/20",
    glow: "",
  },
  radiant: {
    img: "",
    panel:
      "bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20",
    glow: "ring-2 ring-amber-300/80 shadow-[0_0_28px_rgba(251,191,36,0.45)]",
  },
};

export function SoulCardView({
  card,
  locale,
  onClick,
}: {
  card: SoulCardDto;
  locale: string;
  onClick?: () => void;
}) {
  const t = useTranslations("soulCards");
  const rarity = normalizeRarity(card.rarity);
  const element = normalizeElement(card.element);
  const rarityMeta = RARITY_META[rarity];
  const elementMeta = ELEMENT_META[element];
  const stage = stageForLevel(card.growthLevel);
  const fx = STAGE_FX[stage.id] ?? STAGE_FX.seed;
  const isEn = locale === "en";
  const burned = card.status === "burned";
  // Phase 7 · 7.4-1：卡背内容（hover 3D 翻转展示；按证书编号稳定取箴言，与分享图同口径）
  const quote = soulQuoteFor(card.certificateNo, isEn ? "en" : "zh");

  return (
    <button
      type="button"
      onClick={onClick}
      className={`scv-flip group w-full rounded-2xl bg-gradient-to-br p-[3px] text-left shadow-sm transition hover:shadow-md ${rarityMeta.frameClass} ${burned ? "" : fx.glow}`}
    >
      <div className={`scv-flip-inner${burned ? " scv-noflip" : ""}`}>
      <div className="scv-face relative overflow-hidden rounded-[13px] bg-white dark:bg-zinc-900">
        {/* 立绘 */}
        <div className="relative aspect-square w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.petImageUrl}
            alt={card.name}
            className={`h-full w-full object-cover transition group-hover:scale-105 ${burned ? "opacity-40 grayscale" : fx.img}`}
            loading="lazy"
          />
          {burned ? (
            <span className="absolute inset-0 flex items-center justify-center text-4xl">
              🔥
            </span>
          ) : null}
          {/* seed 沉睡形态：💤 标记 */}
          {!burned && stage.id === "seed" ? (
            <span
              className="absolute bottom-2 right-2 animate-pulse text-2xl"
              title={t("sleeping")}
            >
              💤
            </span>
          ) : null}
          {/* radiant 光辉形态：✨ 光辉角标 */}
          {!burned && stage.id === "radiant" ? (
            <span className="absolute bottom-2 right-2 text-2xl" title={t("radiantMark")}>
              ✨
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

        {/* 卡面信息（面板底色随阶段变化） */}
        <div className={`space-y-1.5 p-3 ${burned ? "" : fx.panel}`}>
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
            {/* seed 沉睡形态：编号旁「沉睡中」标注；其余阶段保留 tokenId */}
            {!burned && stage.id === "seed" ? (
              <span className="shrink-0 rounded-full bg-zinc-200/80 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-700/60 dark:text-zinc-400">
                {t("sleeping")}
              </span>
            ) : (
              <span className="shrink-0 font-mono text-[11px] text-zinc-400">
                #{card.tokenId}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 卡背（Phase 7 · 7.4-1：桌面 hover 3D 翻转；burned 不翻转保持庄重；
          移动端无 hover 不触发，正面信息本就完整，无功能损失） */}
      {!burned ? (
        <div className="scv-face scv-back absolute inset-0 flex flex-col overflow-hidden rounded-[13px] bg-white dark:bg-zinc-900">
          {/* 顶部稀有度渐变条 */}
          <span className={`h-1.5 w-full shrink-0 bg-gradient-to-r ${rarityMeta.frameClass}`} />
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center">
            <span className="text-2xl" aria-hidden>
              {rarityMeta.emoji}
            </span>
            <p className="text-[11px] italic leading-relaxed text-zinc-600 dark:text-zinc-300">
              「{quote}」
            </p>
            <p className="text-[11px] text-zinc-400">
              {stage.emoji} Lv.{card.growthLevel} · {elementMeta.emoji}{" "}
              {isEn ? elementMeta.labelEn : elementMeta.labelZh}
            </p>
          </div>
          <div className="shrink-0 space-y-1 p-3 pt-0 text-center">
            <p className="font-mono text-[10px] text-zinc-400">{card.certificateNo}</p>
            {onClick ? (
              <p className="text-[10px] font-medium text-orange-500">{t("flipHint")}</p>
            ) : null}
          </div>
        </div>
      ) : null}
      </div>
      <style jsx>{`
        .scv-flip {
          perspective: 1000px;
        }
        .scv-flip-inner {
          position: relative;
          transform-style: preserve-3d;
          transition: transform 0.55s cubic-bezier(0.2, 0.7, 0.3, 1);
        }
        .scv-flip:hover .scv-flip-inner:not(.scv-noflip) {
          transform: rotateY(180deg);
        }
        .scv-face {
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .scv-back {
          transform: rotateY(180deg);
        }
        @media (prefers-reduced-motion: reduce) {
          .scv-flip-inner {
            transition: none;
          }
          .scv-flip:hover .scv-flip-inner {
            transform: none;
          }
        }
      `}</style>
    </button>
  );
}
