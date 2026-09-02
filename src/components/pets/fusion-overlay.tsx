"use client";

import { useLocale, useTranslations } from "next-intl";

import { LivingPet } from "@/components/LivingPet";
import { PetAvatar } from "@/components/PetAvatar";
import { getRarityMeta } from "@/lib/pet-status";
import { PetWatermark } from "@/components/pets/pet-watermark";
import type { AggPet } from "@/components/pets/aggregated-pet-card";

/**
 * 合成仪式覆盖层：
 *  - fusing：3 只源宠物向中心汇聚 → 强光闪烁（box-shadow 扩散）→ 剪影；
 *  - result：新宠物「砰」地出现，展示稀有度 + 随机文案池（普通进化 / 幸运暴击）。
 */
export function FusionOverlay({
  phase,
  sources,
  outcome,
  onKeep,
  onContinue,
}: {
  phase: "fusing" | "result";
  sources: AggPet[];
  outcome: { pet: AggPet & { defaultDescription?: string }; critical: boolean } | null;
  onKeep: () => void;
  onContinue: () => void;
}) {
  const t = useTranslations("petsCatalog");
  const locale = useLocale();

  if (phase === "fusing") {
    const cls = ["fuse-l", "fuse-m", "fuse-r"];
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/60 backdrop-blur-sm">
        <div className="relative mx-auto flex h-60 w-60 items-center justify-center">
          {/* 源宠物保持静态渲染：fuse-l/m/r 飞行位移动画期间叠加呼吸/转头会互相干扰 */}
          {sources.slice(0, 3).map((p, i) => (
            <PetAvatar
              key={p.id}
              src={p.imageUrl}
              alt={p.speciesName}
              className={`${cls[i] ?? "fuse-m"} absolute h-20 w-20 rounded-2xl border-2 border-orange-200 object-cover shadow-lg`}
            />
          ))}
          {/* 强光扩散 */}
          <div className="fuse-burst absolute inset-4 rounded-full" />
          <div className="fuse-flash absolute inset-6 rounded-full bg-white/80" />
          {/* 剪影：融合中 */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="h-20 w-20 rounded-full bg-zinc-800/30 blur-[2px]" />
          </div>
          <p className="absolute inset-x-0 bottom-0 text-center text-sm font-semibold text-white drop-shadow">
            {t("evolving")}
          </p>
        </div>
      </div>
    );
  }

  // result
  if (!outcome) return null;
  const meta = getRarityMeta(String(outcome.pet.traits.rarity ?? ""));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-2xl">
        {outcome.critical && (
          <span className="mb-2 inline-block animate-pulse rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 px-3 py-1 text-xs font-bold text-white shadow">
            {t("critical")}
          </span>
        )}
        <div className="evolve-glow relative mx-auto rounded-full bg-orange-50">
          <LivingPet
            src={outcome.pet.imageUrl}
            alt={outcome.pet.speciesName}
            className="born-pop h-32 w-32 rounded-full border-4 border-amber-300 object-cover shadow-xl"
          />
          <PetWatermark />
        </div>
        <p className="mt-3 text-sm font-bold text-zinc-900">
          {outcome.critical ? t("fuseCritical") : t("fuseNormal", { name: outcome.pet.speciesName })}
        </p>
        <div className="mt-2 flex items-center justify-center gap-2 text-sm">
          <span className="font-semibold text-zinc-800">{outcome.pet.speciesName}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}>
            {meta.emoji} {locale === "en" ? meta.labelEn : meta.labelZh}
          </span>
          <span className="font-mono text-xs text-orange-500">{outcome.pet.id}</span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">{outcome.pet.defaultDescription}</p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onKeep}
            className="flex-1 rounded-full bg-orange-500 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600"
          >
            {t("keepInBag")}
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="flex-1 rounded-full bg-violet-500 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-600"
          >
            {t("continueFuse")}
          </button>
        </div>
      </div>
    </div>
  );
}
