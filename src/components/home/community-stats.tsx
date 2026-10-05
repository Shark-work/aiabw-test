"use client";

/**
 * 📊 首页底部「社区活跃数据」（Phase 7 · 7.1-6）：
 *  - 数据源 GET /api/home/stats（公开，60s 缓存）：今日新生伙伴 / 今日探索 /
 *    在册灵魂卡 / 收藏家总数；
 *  - 千位格式化按当前 locale（Intl.NumberFormat）；加载中/失败/全 0 静默不渲染。
 */

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

type Stats = {
  bornToday: number;
  explorationsToday: number;
  soulCardsTotal: number;
  collectorsTotal: number;
};

export function CommunityStats() {
  const t = useTranslations("home");
  const locale = useLocale();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/home/stats")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.ok && d.stats && typeof d.stats.collectorsTotal === "number") {
          setStats(d.stats as Stats);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!stats) return null;

  const fmt = new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN");
  const items: { emoji: string; value: number; label: string }[] = [
    { emoji: "🐣", value: stats.bornToday, label: t("statsBornToday") },
    { emoji: "🗺️", value: stats.explorationsToday, label: t("statsExplorationsToday") },
    { emoji: "🃏", value: stats.soulCardsTotal, label: t("statsSoulCards") },
    { emoji: "🌱", value: stats.collectorsTotal, label: t("statsCollectors") },
  ];

  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-white/85 px-6 py-5 shadow-sm backdrop-blur">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {items.map((it) => (
          <div key={it.label} className="text-center">
            <div className="text-lg font-black tabular-nums text-zinc-900">
              <span aria-hidden className="mr-1 text-base">{it.emoji}</span>
              {fmt.format(it.value)}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">{it.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
