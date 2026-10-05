"use client";

/**
 * 🃏 首页「社区灵魂卡」轮播（Phase 7 · 7.1-3）：
 *  - 数据源 GET /api/soul-cards/featured（公开，稀有度优先的流通中灵魂卡 Top10）；
 *  - 滚动模式复用 RecentBornMarquee：≥4 条时内容 ×2 + CSS translateX(-50%) 无缝循环，
 *    悬停暂停、尊重 prefers-reduced-motion；不足 4 条静态展示；空/失败静默不渲染；
 *  - 卡片视觉：稀有度渐变边框（RARITY_META.frameClass）+ 元素 emoji（ELEMENT_META）
 *    + 凭证编号 + 成长等级；点击进 /soul-cards/[id]/public 公开凭证页（拉新转化）。
 */

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import {
  ELEMENT_META,
  RARITY_META,
  type SoulCardElement,
  type SoulCardRarity,
} from "@/lib/soul-card-config";

type FeaturedCard = {
  id: string;
  name: string;
  rarity: string;
  element: string;
  certificateNo: string;
  growthLevel: number;
};

export function SoulCardCarousel() {
  const t = useTranslations("home");
  const ts = useTranslations("seo");
  const locale = useLocale();
  const isEn = locale === "en";
  const [cards, setCards] = useState<FeaturedCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/soul-cards/featured")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.ok && Array.isArray(d.cards)) {
          // 防御性去重（与 RecentBornMarquee 同口径，防 CDN 缓存窗口内重复）
          const list = d.cards as FeaturedCard[];
          setCards(Array.from(new Map(list.map((c) => [c.id, c])).values()));
        }
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // 加载中 / 空数据 / 接口失败 → 静默不渲染（首页模块多，不缺这一块）
  if (loading || cards.length === 0) return null;

  const loop = cards.length >= 4;
  const items = loop ? [...cards, ...cards] : cards;

  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-white/85 p-6 shadow-sm backdrop-blur">
      <h3 className="mb-3 flex items-center justify-between gap-2 text-sm font-semibold text-zinc-800">
        {t("soulCardsTitle")}
        <Link
          href="/soul-cards"
          className="shrink-0 text-[11px] font-medium text-orange-500 transition hover:text-orange-600"
        >
          {ts("viewAll")} →
        </Link>
      </h3>
      <div className="overflow-hidden">
        <div className={`sc-marquee-track flex w-max gap-3${loop ? "" : " sc-marquee-static"}`}>
          {items.map((c, i) => {
            const rarity = RARITY_META[c.rarity as SoulCardRarity] ?? RARITY_META.common;
            const element = ELEMENT_META[c.element as SoulCardElement];
            return (
              <Link
                key={`${c.id}-${i}`}
                href={`/soul-cards/${c.id}/public`}
                className={`w-36 shrink-0 rounded-xl bg-gradient-to-br p-[2px] shadow-sm transition hover:scale-[1.04] hover:shadow-md ${rarity.frameClass}`}
              >
                <span className="flex h-full flex-col gap-1 rounded-[10px] bg-white/95 p-2.5">
                  <span className="flex items-center justify-between">
                    <span className="text-base" aria-hidden>
                      {element?.emoji ?? "✨"}
                    </span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${rarity.badgeClass}`}
                    >
                      {rarity.emoji} {isEn ? rarity.labelEn : rarity.labelZh}
                    </span>
                  </span>
                  <span className="truncate text-xs font-semibold text-zinc-900">{c.name}</span>
                  <span className="flex items-center justify-between text-[10px] text-zinc-400">
                    <span className="truncate">{c.certificateNo}</span>
                    <span className="shrink-0 font-medium text-zinc-500">
                      {t("soulCardsLevel", { level: c.growthLevel })}
                    </span>
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
      <style jsx>{`
        @keyframes scMarquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .sc-marquee-track {
          animation: scMarquee 32s linear infinite;
        }
        .sc-marquee-track:hover {
          animation-play-state: paused;
        }
        .sc-marquee-track.sc-marquee-static {
          animation: none;
          width: auto;
        }
        @media (prefers-reduced-motion: reduce) {
          .sc-marquee-track {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
