"use client";

import { useLocale, useTranslations } from "next-intl";

import { PetAvatar } from "@/components/PetAvatar";
import { getRarityMeta } from "@/lib/pet-status";

export type AggPet = {
  id: string;
  speciesId: string;
  speciesName: string;
  category: string;
  imageUrl: string;
  traits: { element?: string; rarity?: string; personality?: string; [k: string]: unknown };
  generation: number;
  adoptedAt: string | null;
  lastInteractionTime: string | null;
  parentIds: unknown;
};

export type AggGroup = {
  key: string;
  speciesId: string;
  speciesName: string;
  rarity: string;
  imageUrl: string;
  pets: AggPet[];
};

/**
 * 聚合宠物卡片：同物种+同稀有度只显示一张，右上角 xN 角标。
 * - count >= 3 → 可合成高亮；否则普通态。
 * - disabled：互斥（其他组已被勾选）时置灰禁止点击。
 */
export function AggregatedPetCard({
  group,
  disabled,
  onSelect,
}: {
  group: AggGroup;
  disabled?: boolean;
  onSelect: (g: AggGroup) => void;
}) {
  const t = useTranslations("petsCatalog");
  const locale = useLocale();
  const meta = getRarityMeta(group.rarity);
  const evolvable = group.pets.length >= 3;

  return (
    <button
      type="button"
      onClick={() => onSelect(group)}
      disabled={disabled}
      className={`group relative flex flex-col items-center gap-2 rounded-2xl border-2 p-4 text-center transition ${
        disabled
          ? "cursor-not-allowed border-zinc-100 bg-zinc-50 opacity-40"
          : evolvable
            ? "border-violet-200 bg-white shadow-sm hover:border-violet-400 hover:shadow-md"
            : "border-zinc-100 bg-white shadow-sm hover:border-orange-200 hover:shadow-md"
      }`}
    >
      {/* 数量角标 */}
      <span
        className={`absolute -right-1.5 -top-1.5 z-10 flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white shadow ${
          evolvable ? "bg-gradient-to-r from-violet-500 to-fuchsia-500" : "bg-zinc-400"
        }`}
      >
        {t("xCount", { count: group.pets.length })}
      </span>
      {evolvable && (
        <span className="absolute -left-1.5 -top-1.5 z-10 animate-pulse rounded-full bg-violet-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
          {t("evolvable")}
        </span>
      )}

      <PetAvatar
        src={group.imageUrl}
        alt={group.speciesName}
        className="h-16 w-16 rounded-full border-2 border-orange-200 bg-orange-50 object-cover transition group-hover:scale-105"
      />
      <span className="text-sm font-semibold text-zinc-800">{group.speciesName}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}>
        {meta.emoji} {locale === "en" ? meta.labelEn : meta.labelZh}
      </span>
    </button>
  );
}
