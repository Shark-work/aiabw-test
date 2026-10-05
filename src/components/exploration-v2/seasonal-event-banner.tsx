"use client";

/**
 * 探索页顶部 · 季节活动 banner（P2 社交传播 · 改动三）
 * 仅在有进行中活动时渲染：活动名称 + 我的进度（探索/结晶次数，登录时）+ 奖励预览。
 * 无活动 / 拉取失败 → 不渲染（静默降级，不影响探索主流程）。
 * 骨架：占位活动 is_active=false 永不外露；活动结束后接口返回 event=null 自动隐藏。
 */

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  seasonalText,
  type SeasonalEventDto,
  type SeasonalProgressDto,
} from "@/lib/seasonal-config";

export function SeasonalEventBanner() {
  const t = useTranslations("seasonal");
  const locale = useLocale();
  const [data, setData] = useState<{
    event: SeasonalEventDto;
    progress: SeasonalProgressDto | null;
  } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    fetch("/api/seasonal-events/active", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.ok && d.event) setData({ event: d.event, progress: d.progress ?? null });
      })
      .catch(() => {
        /* banner 拉取失败不影响探索主流程 */
      });
  }, []);

  if (!data) return null;
  const { event, progress } = data;
  const endDate = new Date(event.endAt);
  const endLabel = `${endDate.getMonth() + 1}/${endDate.getDate()}`;

  return (
    <section className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 shadow-sm dark:border-amber-900/50 dark:from-amber-950/40 dark:to-orange-950/30">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-amber-700 dark:text-amber-300">
          🎪 {seasonalText(event.name, locale)}
        </h2>
        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:bg-amber-950/60 dark:text-amber-300">
          {t("until", { date: endLabel })}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        {seasonalText(event.description, locale)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        {progress ? (
          <span className="rounded-full bg-white/80 px-2.5 py-1 font-semibold text-zinc-600 dark:bg-zinc-900/60 dark:text-zinc-300">
            {t("progress", {
              e: progress.explorationCount,
              c: progress.bondCrystals,
            })}
            {progress.claimed ? ` · ${t("claimed")}` : ""}
          </span>
        ) : null}
        {event.rewards.points ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
            {t("rewardPoints", { n: event.rewards.points })}
          </span>
        ) : null}
        {event.rewards.vipDays ? (
          <span className="rounded-full bg-violet-100 px-2.5 py-1 font-semibold text-violet-600 dark:bg-violet-950/60 dark:text-violet-300">
            {t("rewardVipDays", { n: event.rewards.vipDays })}
          </span>
        ) : null}
      </div>
    </section>
  );
}
