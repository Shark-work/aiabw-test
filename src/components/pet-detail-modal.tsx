"use client";

import { useLocale, useTranslations } from "next-intl";

import { PetAvatar } from "@/components/PetAvatar";
import { PetWatermark } from "@/components/pets/pet-watermark";
import { getRarityMeta } from "@/lib/pet-status";

export type FeaturedPet = {
  id: string;
  speciesId: string;
  speciesName: string;
  category: string;
  imageUrl: string;
  traits: { element?: string; rarity?: string; personality?: string; [k: string]: unknown };
  generation: number;
  defaultDescription: string;
  adopted: number;
  isRare: boolean;
};

/**
 * 宠物详情半屏弹窗（首页转化 CTA）：
 *  - 展示动态推荐宠大图 + 稀有度 + 描述 + 稀缺/热度标记；
 *  - 底部明确的「获得（领养）」按钮，缩短决策路径；
 *  - 大图叠加 © 水印，防截图盗用。
 */
export function PetDetailModal({
  pet,
  busy,
  onAdopt,
  onClose,
}: {
  pet: FeaturedPet;
  busy?: boolean;
  onAdopt: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("home");
  const locale = useLocale();
  const meta = getRarityMeta(String(pet.traits.rarity ?? "common"));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/50 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-3xl border border-zinc-200 bg-white p-5 text-center shadow-2xl sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative mx-auto w-fit rounded-full bg-orange-50">
          <PetAvatar
            src={pet.imageUrl}
            alt={pet.speciesName}
            className="h-36 w-36 rounded-full border-4 border-orange-200 object-cover shadow-lg"
          />
          <PetWatermark />
        </div>

        <div className="mt-3 flex items-center justify-center gap-2">
          <h3 className="text-lg font-bold text-zinc-900">{pet.speciesName}</h3>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}>
            {meta.emoji} {locale === "en" ? meta.labelEn : meta.labelZh}
          </span>
        </div>

        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-zinc-500">{pet.defaultDescription}</p>

        <div className="mt-3 flex items-center justify-center gap-2 text-[11px]">
          {pet.isRare && (
            <span className="rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 px-2.5 py-1 font-semibold text-white">
              {t("detailRare")}
            </span>
          )}
          <span className="rounded-full bg-orange-50 px-2.5 py-1 font-medium text-orange-700">
            {t("detailAdopted", { count: pet.adopted })}
          </span>
          <span className="rounded-full bg-zinc-50 px-2.5 py-1 font-medium text-zinc-500">
            {t("detailGeneration", { gen: pet.generation })}
          </span>
        </div>

        <button
          type="button"
          onClick={onAdopt}
          disabled={busy}
          className="mt-5 w-full rounded-full bg-orange-500 py-3 text-base font-bold text-white shadow-lg transition hover:bg-orange-600 hover:shadow-xl disabled:opacity-60"
        >
          {busy ? t("crafting") : t("get")}
        </button>
        <p className="mt-2 text-[11px] text-zinc-400">{t("getHint")}</p>
      </div>
    </div>
  );
}
