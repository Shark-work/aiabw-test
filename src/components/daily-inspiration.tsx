"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { LivingPet } from "@/components/LivingPet";

type LuckyPet = {
  id: string;
  speciesId: string;
  speciesName: string;
  category: string;
  imageUrl: string;
  traits: { element?: string; rarity?: string; personality?: string; [k: string]: unknown };
  trait: string;
  traitEn: string;
  generation: number;
};

type RecentBorn = {
  id: string;
  speciesName: string;
  rarity: string;
  imageUrl: string;
  ownerLabel: string;
};

function elementKey(t: (k: string) => string, element: string): string {
  if (element === "fire") return t("zodiacFire");
  if (element === "air") return t("zodiacAir");
  if (element === "water") return t("zodiacWater");
  return t("zodiacEarth");
}

/**
 * 🔮 顶部通告栏（Alert Banner，首页重构版）：今日运势 · 幸运宠。
 *  - 紧凑单行横幅，放在页面最顶端，不再抢占头条视觉重心；
 *  - 数据源 /api/pets/daily（每日日期确定性选宠）。
 */
export function FortuneBanner() {
  const t = useTranslations("home");
  const locale = useLocale();
  const [lucky, setLucky] = useState<LuckyPet | null>(null);
  const [element, setElement] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/pets/daily")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.ok) {
          setLucky(d.lucky ?? null);
          setElement(d.zodiacElement ?? "");
        }
      })
      .catch(() => {})
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // 加载中/无幸运宠：通告栏直接让位，不占页面高度
  if (!ready || !lucky) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-orange-200 bg-gradient-to-r from-orange-50 via-amber-50 to-orange-50 px-4 py-2.5 shadow-sm">
      <span className="shrink-0 text-xl" aria-hidden>
        🔮
      </span>
      <p className="min-w-0 flex-1 truncate text-sm text-zinc-700">
        {t("fortune", {
          sign: elementKey(t, element),
          name: lucky.speciesName,
          trait: locale === "en" ? lucky.traitEn : lucky.trait,
        })}
      </p>
      <Link
        href={`/pets?species=${encodeURIComponent(lucky.speciesId)}`}
        className="shrink-0 rounded-full bg-orange-500 px-3.5 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-orange-600"
      >
        {t("meet")} →
      </Link>
    </div>
  );
}

/**
 * 🐾 实时动态 · 刚刚诞生的伙伴（首页重构版）：横向滚动跑马灯。
 *  - 紧贴盲盒卡片下方，营造「很多人正在玩」的热闹氛围；
 *  - 内容 ×2 拼接 + CSS translateX(-50%) 实现无缝循环（尊重 prefers-reduced-motion）；
 *  - 数据源 /api/pets/daily 的 recent（最近 3 只稀有宠）。
 */
export function RecentBornMarquee() {
  const t = useTranslations("home");
  const ts = useTranslations("seo");
  const [recent, setRecent] = useState<RecentBorn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/pets/daily")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.ok) setRecent(d.recent ?? []);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading || recent.length === 0) return null;

  // 数据翻倍拼接实现无缝循环滚动
  const items = recent.length > 1 ? [...recent, ...recent] : recent;

  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-white/85 p-6 shadow-sm backdrop-blur">
      <h3 className="mb-3 flex items-center justify-between gap-2 text-sm font-semibold text-zinc-800">
        {t("recentTitle")}
        <Link
          href="/pets"
          className="shrink-0 text-[11px] font-medium text-orange-500 transition hover:text-orange-600"
        >
          {ts("viewAll")} →
        </Link>
      </h3>
      <div className="overflow-hidden">
        <div className="marquee-track flex w-max gap-3">
          {items.map((p, i) => (
            <Link
              key={`${p.id}-${i}`}
              href={`/pets?rarity=${encodeURIComponent(p.rarity)}`}
              className="flex w-44 shrink-0 items-center gap-2 rounded-xl border border-zinc-100 bg-orange-50/60 p-2 transition hover:border-orange-300"
            >
              <LivingPet
                src={p.imageUrl}
                alt={p.speciesName}
                tail={false}
                delay={(i % 3) * 0.3}
                className="h-9 w-9 shrink-0 rounded-full border border-orange-200 bg-white object-cover"
              />
              <span className="min-w-0 text-[11px] leading-snug text-zinc-600">
                {t("recentItem", { user: p.ownerLabel, name: p.speciesName, id: p.id })}
              </span>
            </Link>
          ))}
        </div>
      </div>
      <style jsx>{`
        @keyframes bxMarquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .marquee-track {
          animation: bxMarquee 28s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .marquee-track {
            animation: none;
            overflow-x: auto;
          }
        }
      `}</style>
    </div>
  );
}

