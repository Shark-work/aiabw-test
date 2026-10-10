"use client";

/**
 * 探索页 · 大陆区域图鉴（2026-10-16 世界观体系）
 *  - 8 大区域紧凑卡片（横向滚动）：emoji / 名称 / 地脉标签；
 *  - 点击卡片弹出「区域志」弹窗（类型 / 地脉 / 代表灵宠 / 氛围描述）；
 *  - 数据源：src/lib/worldview-data.ts 单一数据源静态 import（零网络依赖，
 *    与 /world 页同口径；GET /api/world 供外部查询与种子验证）；
 *  - 右上角「🌍 世界观」链接到 /world 百科页。
 */

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { WORLD_REGIONS, type WorldRegion } from "@/lib/worldview-data";

export function WorldRegionsSection() {
  const t = useTranslations("worldview");
  const tc = useTranslations("common");
  const locale = useLocale();
  const en = locale === "en";
  const [active, setActive] = useState<WorldRegion | null>(null);

  return (
    <section className="rounded-2xl border border-zinc-100 bg-white/70 p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-zinc-900">{t("regionsExploreTitle")}</h3>
          <p className="mt-0.5 text-[11px] text-zinc-400">{t("regionsExploreSubtitle")}</p>
        </div>
        <Link
          href="/world"
          className="shrink-0 text-[11px] font-medium text-violet-500 transition hover:text-violet-600"
        >
          {t("worldLink")}
        </Link>
      </div>

      {/* 8 区域卡（横向滚动，移动端友好） */}
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {WORLD_REGIONS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setActive(r)}
            className="flex w-28 shrink-0 flex-col items-center rounded-xl border border-zinc-100 bg-white px-2 py-3 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow"
          >
            <span className="text-2xl" aria-hidden>{r.emoji}</span>
            <span className="mt-1 text-xs font-bold text-zinc-800">{en ? r.nameEn : r.nameZh}</span>
            <span className="mt-0.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-500">
              {en ? r.elementEn : r.elementZh}
            </span>
          </button>
        ))}
      </div>

      {/* 区域志弹窗 */}
      {active && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/50 p-4 backdrop-blur-sm"
          onClick={() => setActive(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-3xl" aria-hidden>{active.emoji}</span>
                <div>
                  <h4 className="text-base font-bold text-zinc-900">{en ? active.nameEn : active.nameZh}</h4>
                  <p className="text-[11px] text-zinc-400">
                    {t("regionLoreTitle")} · {en ? active.typeEn : active.typeZh}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActive(null)}
                aria-label={tc("close")}
                className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-400 transition hover:text-zinc-600"
              >
                ✕
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
              <span className="rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-600">
                {t("elementLabel")} · {en ? active.elementEn : active.elementZh}
              </span>
              <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-600">
                {t("representativesLabel")} · {en ? active.representativesEn : active.representativesZh}
              </span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-zinc-600">
              {en ? active.descriptionEn : active.descriptionZh}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
