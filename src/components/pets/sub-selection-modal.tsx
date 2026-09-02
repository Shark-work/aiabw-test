"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { LivingPet } from "@/components/LivingPet";
import { getRarityMeta } from "@/lib/pet-status";
import type { AggGroup } from "@/components/pets/aggregated-pet-card";

/**
 * 子选择层：列出组内个体，用户勾选 3 只进行合成；每只可「放生」。
 * - 最多勾选 3 只（同组）；达到 3 只后其余个体禁止勾选。
 * - 放生：点击 🗑️ → 顶部滑出二次确认条（不可撤销文案）→ 确认后调 release。
 */
export function SubSelectionModal({
  group,
  checkedIds,
  onToggle,
  onRelease,
  onClose,
}: {
  group: AggGroup;
  checkedIds: string[];
  onToggle: (id: string) => void;
  onRelease: (id: string, name: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("petsCatalog");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [confirmPet, setConfirmPet] = useState<{ id: string; name: string } | null>(null);

  const full = checkedIds.length >= 3;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/50 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-3xl border border-zinc-200 bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-zinc-900">
              {t("selectTitle")} · {group.speciesName}{" "}
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${getRarityMeta(group.rarity).badgeClass}`}>
                {getRarityMeta(group.rarity).emoji}{" "}
                {locale === "en" ? getRarityMeta(group.rarity).labelEn : getRarityMeta(group.rarity).labelZh}
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">{t("selectHint", { count: 3 })}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
            aria-label={tc("close")}
          >
            ×
          </button>
        </div>

        {/* 放生二次确认条（防呆：不可撤销） */}
        {confirmPet && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-medium leading-relaxed text-red-700">
              {t("releaseConfirm", { name: confirmPet.name })}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onRelease(confirmPet.id, confirmPet.name);
                  setConfirmPet(null);
                }}
                className="flex-1 rounded-full bg-red-500 py-1.5 text-xs font-semibold text-white transition hover:bg-red-600"
              >
                {t("release")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmPet(null)}
                className="flex-1 rounded-full border border-zinc-200 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-50"
              >
                {tc("cancel")}
              </button>
            </div>
          </div>
        )}

        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {group.pets.map((p, i) => {
            const checked = checkedIds.includes(p.id);
            const disabled = !checked && full;
            return (
              <div
                key={p.id}
                className={`flex items-center gap-2.5 rounded-xl border-2 px-2.5 py-2 transition ${
                  checked
                    ? "border-violet-500 bg-violet-50"
                    : disabled
                      ? "border-zinc-100 bg-zinc-50 opacity-50"
                      : "border-zinc-100 bg-white hover:border-violet-200"
                }`}
              >
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onToggle(p.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <LivingPet
                    src={p.imageUrl}
                    alt={p.speciesName}
                    tail={false}
                    delay={(i % 4) * 0.3}
                    className="h-11 w-11 shrink-0 rounded-full border border-orange-200 object-cover"
                  />
                  <span className="min-w-0">
                    <span className="block font-mono text-xs font-semibold text-zinc-700">{p.id}</span>
                    <span className="block text-[10px] text-zinc-400">
                      ❤️{p.traits.personality ?? "?"} · 第 {p.generation} 代
                    </span>
                  </span>
                </button>

                {checked && <span className="shrink-0 text-sm font-bold text-violet-600">✓</span>}

                <button
                  type="button"
                  onClick={() => setConfirmPet({ id: p.id, name: p.speciesName })}
                  className="shrink-0 rounded-full px-2 py-1 text-base transition hover:bg-red-50"
                  title={t("release")}
                  aria-label={t("release")}
                >
                  🗑️
                </button>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-center text-[11px] text-zinc-400">{checkedIds.length}/3</p>
      </div>
    </div>
  );
}

