"use client";

/**
 * HomeAibiSection · 首页「艾比世界」区块（Phase 7 · 8.1）
 * 展示：平台介绍 + 当前总供应量 + 最新铸造艾比 + 热门稀有艾比 + 卡包/图鉴/背包入口。
 * 数据源：GET /api/aibi/spotlight + GET /api/aibi/supply（公开读，未登录可浏览）；
 * 区块失败静默降级（入口卡片始终可用），不影响首页原有模块。
 */
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { AibiCard } from "./aibi-card";
import { aibiFetch } from "@/lib/aibi-client";
import { speciesCardToken, type AibiTokenDto } from "@/lib/aibi-visual";

interface SpotlightResp {
  latest: {
    aibiTokenId: string;
    speciesId: string;
    mintedAt: string | null;
    species: AibiTokenDto["species"];
  }[];
  rareShowcase: {
    speciesId: string;
    mintedCount: number;
    species: AibiTokenDto["species"];
  }[];
}

export function HomeAibiSection() {
  const t = useTranslations("aibi.spotlight");
  const locale = useLocale();
  const [latest, setLatest] = useState<SpotlightResp["latest"]>([]);
  const [rare, setRare] = useState<SpotlightResp["rareShowcase"]>([]);
  const [supply, setSupply] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      aibiFetch<SpotlightResp>("/api/aibi/spotlight", { locale }),
      aibiFetch<{ currentSupply: number }>("/api/aibi/supply?pageSize=1", { locale }),
    ])
      .then(([spot, su]) => {
        if (cancelled) return;
        setLatest(spot.latest);
        setRare(spot.rareShowcase);
        setSupply(su.currentSupply);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [locale]);

  return (
    <section className="space-y-4 rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-amber-50 p-5 shadow-sm dark:border-zinc-700 dark:from-zinc-900 dark:via-zinc-900 dark:to-zinc-800">
      {/* 介绍 + 当前总供应量 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-zinc-900 dark:text-zinc-50">🧬 {t("title")}</h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
        </div>
        <Link
          href="/supply"
          className="rounded-full border border-indigo-200 bg-white/80 px-4 py-1.5 text-xs font-bold text-indigo-600 shadow-sm transition hover:shadow dark:border-zinc-600 dark:bg-zinc-800 dark:text-indigo-300"
          title={t("supplyNow")}
        >
          ⛓️ {t("supplyNow")} {supply ?? "…"}
        </Link>
      </div>

      {/* 入口：卡包 / 图鉴 / 背包 */}
      <div className="grid grid-cols-3 gap-2">
        <Link
          href="/packs"
          className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3 text-center transition hover:shadow-md dark:border-amber-900/50 dark:bg-amber-950/30"
        >
          <p className="text-xl">🎴</p>
          <p className="mt-1 text-xs font-bold text-amber-700 dark:text-amber-300">{t("entryPacks")}</p>
          <p className="mt-0.5 text-[10px] text-amber-600/70 dark:text-amber-400/60">{t("entryPacksDesc")}</p>
        </Link>
        <Link
          href="/codex"
          className="rounded-2xl border border-indigo-200 bg-indigo-50/80 p-3 text-center transition hover:shadow-md dark:border-indigo-900/50 dark:bg-indigo-950/30"
        >
          <p className="text-xl">📖</p>
          <p className="mt-1 text-xs font-bold text-indigo-700 dark:text-indigo-300">{t("entryCodex")}</p>
          <p className="mt-0.5 text-[10px] text-indigo-600/70 dark:text-indigo-400/60">{t("entryCodexDesc")}</p>
        </Link>
        <Link
          href="/bag"
          className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3 text-center transition hover:shadow-md dark:border-emerald-900/50 dark:bg-emerald-950/30"
        >
          <p className="text-xl">🎒</p>
          <p className="mt-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">{t("entryBag")}</p>
          <p className="mt-0.5 text-[10px] text-emerald-600/70 dark:text-emerald-400/60">{t("entryBagDesc")}</p>
        </Link>
      </div>

      {/* 最新铸造 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-bold text-zinc-700 dark:text-zinc-200">✨ {t("latestMinted")}</p>
          <Link href="/supply" className="text-[11px] font-semibold text-indigo-500 hover:underline">
            {t("viewAll")} →
          </Link>
        </div>
        {latest.length > 0 ? (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {latest.map((tk) => (
              <div key={tk.aibiTokenId} className="w-32 shrink-0">
                <AibiCard
                  token={{
                    aibiTokenId: tk.aibiTokenId,
                    speciesId: tk.speciesId,
                    status: "minted",
                    physicalBound: false,
                    createdAt: tk.mintedAt ?? "",
                    personalityType: null,
                    mood: null,
                    affinity: null,
                    energy: null,
                    growthLevel: null,
                    growthExp: null,
                    species: tk.species,
                  }}
                  locale={locale}
                  size="sm"
                  href={`/aibi/${tk.aibiTokenId}`}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-zinc-200 px-4 py-4 text-center text-xs text-zinc-400 dark:border-zinc-700">
            {t("empty")}
          </p>
        )}
      </div>

      {/* 热门稀有 */}
      {rare.length > 0 ? (
        <div>
          <p className="mb-2 text-sm font-bold text-zinc-700 dark:text-zinc-200">🏆 {t("rareShowcase")}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {rare.map((r) =>
              r.species ? (
                <AibiCard
                  key={r.speciesId}
                  token={speciesCardToken(r.species)}
                  locale={locale}
                  size="sm"
                  statusTag={t("mintedCount", { count: r.mintedCount })}
                  hoverInfo
                />
              ) : null,
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
