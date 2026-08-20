"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { PetAvatar } from "@/components/PetAvatar";

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

/**
 * 「艾比每日灵感」组合模块（替换首页旧版 AI 工具诊断）：
 *  上半：🔮 今日运势·幸运宠（每日更新，日期确定性选宠 + 星座元素呼应）
 *  下半：✨ 高光时刻·最新诞生（最近 3 只稀有宠实时滚动）
 * 移动端上下自动堆叠；无新数据时展示兜底文案。
 */
export function DailyInspiration() {
  const t = useTranslations("home");
  const locale = useLocale();
  const [lucky, setLucky] = useState<LuckyPet | null>(null);
  const [recent, setRecent] = useState<RecentBorn[]>([]);
  const [element, setElement] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/pets/daily")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.ok) {
          setLucky(d.lucky);
          setRecent(d.recent ?? []);
          setElement(d.zodiacElement ?? "");
        }
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white/70 p-5 text-center text-sm text-zinc-400 shadow-sm backdrop-blur">
        {t("dailyLoading")}
      </div>
    );
  }

  // 星座元素 → i18n 文案键（zh：水象；en：Water sign）
  const elementKey =
    element === "fire"
      ? t("zodiacFire")
      : element === "air"
        ? t("zodiacAir")
        : element === "water"
          ? t("zodiacWater")
          : t("zodiacEarth");

  return (
    <section className="w-full max-w-2xl space-y-3">
      {/* 上半部分：今日运势 · 幸运宠 */}
      <div className="rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 via-amber-50 to-rose-50 p-4 shadow-sm">
        <div className="flex items-center gap-4">
          {lucky ? (
            <PetAvatar
              src={lucky.imageUrl}
              alt={lucky.speciesName}
              className="h-16 w-16 shrink-0 rounded-2xl border-2 border-orange-200 bg-white object-cover shadow-sm"
            />
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-2xl">
              🐾
            </span>
          )}
          <p className="min-w-0 flex-1 text-sm leading-relaxed text-zinc-700">
            {lucky
              ? t("fortune", {
                  sign: elementKey,
                  name: lucky.speciesName,
                  trait: locale === "en" ? lucky.traitEn : lucky.trait,
                })
              : t("fortuneEmpty")}
          </p>
        </div>
        {lucky && (
          <Link
            href={`/pets?species=${encodeURIComponent(lucky.speciesId)}`}
            className="mt-3 block w-full rounded-full bg-orange-500 py-2.5 text-center text-sm font-semibold text-white shadow transition hover:bg-orange-600 hover:shadow-md"
          >
            {t("meet")}
          </Link>
        )}
      </div>

      {/* 下半部分：高光时刻 · 最新诞生 */}
      <div className="rounded-2xl border border-zinc-200 bg-white/85 p-4 shadow-sm backdrop-blur">
        <h3 className="mb-2 text-sm font-semibold text-zinc-800">{t("recentTitle")}</h3>
        {recent.length === 0 ? (
          <p className="rounded-xl bg-orange-50 py-5 text-center text-xs text-zinc-500">
            {t("recentEmpty")}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            {recent.map((p) => (
              <Link
                key={p.id}
                href={`/pets?rarity=${encodeURIComponent(p.rarity)}`}
                className="group flex items-center gap-2.5 rounded-xl border border-zinc-100 bg-orange-50/60 p-2.5 transition hover:border-orange-300 hover:bg-orange-50"
              >
                <PetAvatar
                  src={p.imageUrl}
                  alt={p.speciesName}
                  className="h-9 w-9 shrink-0 rounded-full border border-orange-200 bg-white object-cover"
                />
                <span className="min-w-0 text-xs leading-snug text-zinc-600">
                  {t("recentItem", { user: p.ownerLabel, name: p.speciesName, id: p.id })}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
