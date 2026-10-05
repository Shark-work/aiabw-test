"use client";

/**
 * 灵魂卡对比弹窗（Phase 7 · 7.4-5）：
 *  - 上半：两卡面并排（只读，不传 onClick）；下半：关键属性对照表；
 *  - 对照行：稀有度/元素/成长等级/成长阶段/物种/凭证号/铸造时间；
 *  - 成长等级行高亮较高者（绿色加粗，竞争心理外显）；稀有度按权重同样高亮。
 */

import { useTranslations } from "next-intl";

import {
  ELEMENT_META,
  RARITY_META,
  RARITY_ORDER,
  normalizeElement,
  normalizeRarity,
  stageForLevel,
} from "@/lib/soul-card-config";
import { SoulCardView } from "./soul-card-view";
import type { SoulCardDto } from "./soul-card-types";

export function SoulCardCompareModal({
  a,
  b,
  locale,
  onClose,
}: {
  a: SoulCardDto;
  b: SoulCardDto;
  locale: string;
  onClose: () => void;
}) {
  const t = useTranslations("soulCards.compare");
  const isEn = locale === "en";

  const rarityA = normalizeRarity(a.rarity);
  const rarityB = normalizeRarity(b.rarity);
  const elementA = normalizeElement(a.element);
  const elementB = normalizeElement(b.element);
  const stageA = stageForLevel(a.growthLevel);
  const stageB = stageForLevel(b.growthLevel);
  const mintedA = new Date(a.mintedAt).toLocaleDateString(isEn ? "en-US" : "zh-CN");
  const mintedB = new Date(b.mintedAt).toLocaleDateString(isEn ? "en-US" : "zh-CN");

  /** win: 'a' | 'b' | null —— 该行数值更高者（高亮绿色）；null = 不比高低 */
  const rows: { label: string; va: string; vb: string; win: "a" | "b" | null }[] = [
    {
      label: t("rowRarity"),
      va: `${RARITY_META[rarityA].emoji} ${isEn ? RARITY_META[rarityA].labelEn : RARITY_META[rarityA].labelZh}`,
      vb: `${RARITY_META[rarityB].emoji} ${isEn ? RARITY_META[rarityB].labelEn : RARITY_META[rarityB].labelZh}`,
      win: RARITY_ORDER[rarityA] === RARITY_ORDER[rarityB] ? null : RARITY_ORDER[rarityA] > RARITY_ORDER[rarityB] ? "a" : "b",
    },
    {
      label: t("rowElement"),
      va: `${ELEMENT_META[elementA].emoji} ${isEn ? ELEMENT_META[elementA].labelEn : ELEMENT_META[elementA].labelZh}`,
      vb: `${ELEMENT_META[elementB].emoji} ${isEn ? ELEMENT_META[elementB].labelEn : ELEMENT_META[elementB].labelZh}`,
      win: null,
    },
    {
      label: t("rowLevel"),
      va: `Lv.${a.growthLevel}`,
      vb: `Lv.${b.growthLevel}`,
      win: a.growthLevel === b.growthLevel ? null : a.growthLevel > b.growthLevel ? "a" : "b",
    },
    {
      label: t("rowStage"),
      va: `${stageA.emoji} ${isEn ? stageA.labelEn : stageA.labelZh}`,
      vb: `${stageB.emoji} ${isEn ? stageB.labelEn : stageB.labelZh}`,
      win: null,
    },
    {
      label: t("rowSpecies"),
      va: isEn ? a.speciesNameEn : a.speciesNameZh,
      vb: isEn ? b.speciesNameEn : b.speciesNameZh,
      win: null,
    },
    { label: t("rowCert"), va: a.certificateNo, vb: b.certificateNo, win: null },
    { label: t("rowMinted"), va: mintedA, vb: mintedB, win: null },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">{t("title")}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {t("close")}
          </button>
        </div>

        {/* 两卡面并排（只读） */}
        <div className="grid grid-cols-2 gap-3">
          <SoulCardView card={a} locale={locale} />
          <SoulCardView card={b} locale={locale} />
        </div>

        {/* 属性对照表 */}
        <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
          {rows.map((r, i) => (
            <div
              key={r.label}
              className={`grid grid-cols-[5.5rem_1fr_1fr] items-center gap-2 px-3 py-2 text-xs ${
                i % 2 === 0 ? "bg-zinc-50/70 dark:bg-zinc-800/40" : ""
              }`}
            >
              <span className="text-zinc-500 dark:text-zinc-400">{r.label}</span>
              <span
                className={`truncate text-center ${
                  r.win === "a" ? "font-bold text-emerald-600 dark:text-emerald-400" : "text-zinc-700 dark:text-zinc-200"
                }`}
              >
                {r.va}
              </span>
              <span
                className={`truncate text-center ${
                  r.win === "b" ? "font-bold text-emerald-600 dark:text-emerald-400" : "text-zinc-700 dark:text-zinc-200"
                }`}
              >
                {r.vb}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
