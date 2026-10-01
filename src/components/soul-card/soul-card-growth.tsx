"use client";

/**
 * 成长状态组件：阶段徽章 + 等级 + 经验进度条（纯展示）。
 * 经验口径：src/lib/soul-card-config.ts（exp 为当前等级内进度）。
 */

import { useTranslations } from "next-intl";

import {
  expToNextLevel,
  GROWTH_LEVEL_MAX,
  stageForLevel,
} from "@/lib/soul-card-config";

export function SoulCardGrowth({
  level,
  exp,
  locale,
}: {
  level: number;
  exp: number;
  locale: string;
}) {
  const t = useTranslations("soulCards");
  const stage = stageForLevel(level);
  const isEn = locale === "en";
  const need = expToNextLevel(level);
  const percent = need > 0 ? Math.min(100, Math.round((exp / need) * 100)) : 100;

  return (
    <section className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {t("detail.growth")}
        </h3>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          {stage.emoji} {isEn ? stage.labelEn : stage.labelZh} · Lv.{level}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        {level >= GROWTH_LEVEL_MAX
          ? t("growthMax")
          : t("expToNext", { exp: Math.max(0, need - exp) })}
      </p>
    </section>
  );
}
