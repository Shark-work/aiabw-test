"use client";

/**
 * 属性区块：元素 / 栖息地 / AI 性格 / 稀有度（纯展示）。
 */

import { useTranslations } from "next-intl";

import {
  ELEMENT_META,
  RARITY_META,
  normalizeElement,
  normalizeRarity,
} from "@/lib/soul-card-config";
import type { SoulCardDto } from "./soul-card-types";

export function SoulCardAttributes({
  card,
  locale,
}: {
  card: SoulCardDto;
  locale: string;
}) {
  const t = useTranslations("soulCards");
  const isEn = locale === "en";
  const rarityMeta = RARITY_META[normalizeRarity(card.rarity)];
  const elementMeta = ELEMENT_META[normalizeElement(card.element)];
  const personality =
    typeof card.aiPersonality?.personality === "string"
      ? card.aiPersonality.personality
      : "—";

  const rows: Array<{ label: string; value: string }> = [
    {
      label: t("attrs.rarity"),
      value: `${rarityMeta.emoji} ${isEn ? rarityMeta.labelEn : rarityMeta.labelZh}`,
    },
    {
      label: t("attrs.element"),
      value: `${elementMeta.emoji} ${isEn ? elementMeta.labelEn : elementMeta.labelZh}`,
    },
    { label: t("attrs.habitat"), value: card.habitat ?? "—" },
    { label: t("attrs.personality"), value: personality },
  ];

  return (
    <section className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
      <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {t("detail.attributes")}
      </h3>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {row.label}
            </dt>
            <dd className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
