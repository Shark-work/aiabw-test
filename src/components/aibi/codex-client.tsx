"use client";

/**
 * CodexClient · 艾比图鉴页（Phase 7 · 8.2）
 *  - 全部物种（GET /api/aibi/list）+ 稀有度/元素/栖息地三维筛选 + 已拥有/未拥有状态；
 *  - 已拥有 = 登录后 GET /api/bag/aibis 命中的 speciesId 集合（客户端 join；未登录全部未拥有）；
 *  - 分页：客户端分页 PAGE_SIZE=12（文档「列表页必须支持分页」，物种扩容后即生效）；
 *  - 物种卡统一走 AibiCard（speciesCardToken 适配，statusTag 显示拥有状态）。
 */
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { AibiCard } from "./aibi-card";
import { AibiErrorBanner } from "./aibi-error-banner";
import { aibiFetch, AibiClientError, readAibiToken } from "@/lib/aibi-client";
import { AIBI_HABITATS, AIBI_RARITIES } from "@/lib/aibi-catalog";
import { AIBI_ELEMENT_I18N, speciesCardToken, type AibiTokenDto } from "@/lib/aibi-visual";

type SpeciesRow = NonNullable<AibiTokenDto["species"]> & { mintedCount: number };

const PAGE_SIZE = 12;

export function CodexClient() {
  const t = useTranslations("aibi.codex");
  const locale = useLocale();
  const isEn = locale === "en";
  const [species, setSpecies] = useState<SpeciesRow[]>([]);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [rarity, setRarity] = useState("");
  const [element, setElement] = useState("");
  const [habitat, setHabitat] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await aibiFetch<{ species: SpeciesRow[] }>("/api/aibi/list", { locale });
        if (cancelled) return;
        setSpecies(data.species);
        // 拥有状态：登录用户拉背包做客户端 join（未登录保持空集）
        if (readAibiToken()) {
          const bag = await aibiFetch<{ tokens: { speciesId: string }[] }>("/api/bag/aibis", {
            locale,
          });
          if (!cancelled) setOwned(new Set(bag.tokens.map((tk) => tk.speciesId)));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof AibiClientError ? e.message : t("loadFailed"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, t]);

  /** 元素筛选选项：从当前物种集合动态收集（catalog 扩容自动跟随） */
  const elements = useMemo(() => [...new Set(species.map((s) => s.element))], [species]);

  const filtered = useMemo(
    () =>
      species.filter(
        (s) =>
          (!rarity || s.rarityId === rarity) &&
          (!element || s.element === element) &&
          (!habitat || s.habitatId === habitat),
      ),
    [species, rarity, element, habitat],
  );

  // 筛选变化后回到第一页（避免停在空页）
  useEffect(() => {
    setPage(1);
  }, [rarity, element, habitat]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const ownedCount = species.filter((s) => owned.has(s.id)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-black text-zinc-900 dark:text-zinc-50">📖 {t("title")}</h1>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
        </div>
        <p className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
          {t("ownedCount", { owned: ownedCount, total: species.length })}
        </p>
      </div>

      {/* 三维筛选：稀有度 / 元素 / 栖息地 */}
      <div className="grid grid-cols-3 gap-2">
        <select
          aria-label={t("filterRarity")}
          value={rarity}
          onChange={(e) => setRarity(e.target.value)}
          className="rounded-xl border border-zinc-200 bg-white px-2 py-2 text-xs font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        >
          <option value="">{t("filterRarity")} · {t("all")}</option>
          {AIBI_RARITIES.map((r) => (
            <option key={r.id} value={r.id}>
              {isEn ? r.nameEn : r.nameZh}
            </option>
          ))}
        </select>
        <select
          aria-label={t("filterElement")}
          value={element}
          onChange={(e) => setElement(e.target.value)}
          className="rounded-xl border border-zinc-200 bg-white px-2 py-2 text-xs font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        >
          <option value="">{t("filterElement")} · {t("all")}</option>
          {elements.map((el) => (
            <option key={el} value={el}>
              {isEn ? (AIBI_ELEMENT_I18N[el]?.en ?? el) : el}
            </option>
          ))}
        </select>
        <select
          aria-label={t("filterHabitat")}
          value={habitat}
          onChange={(e) => setHabitat(e.target.value)}
          className="rounded-xl border border-zinc-200 bg-white px-2 py-2 text-xs font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        >
          <option value="">{t("filterHabitat")} · {t("all")}</option>
          {AIBI_HABITATS.map((h) => (
            <option key={h.id} value={h.id}>
              {isEn ? h.nameEn : h.nameZh}
            </option>
          ))}
        </select>
      </div>

      {error ? <AibiErrorBanner message={error} onClose={() => setError(null)} /> : null}

      {/* 物种网格：统一 AibiCard；未拥有降饱和提示收集进度 */}
      {pageRows.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {pageRows.map((sp) => {
            const has = owned.has(sp.id);
            return (
              <div key={sp.id} className={has ? "" : "opacity-80 saturate-[0.65]"}>
                <AibiCard
                  token={speciesCardToken(sp)}
                  locale={locale}
                  statusTag={has ? t("owned") : t("unowned")}
                  hoverInfo
                />
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-zinc-200 px-4 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">
          {t("empty")}
        </p>
      )}

      {/* 分页（文档：列表页必须支持分页） */}
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-3 pt-1">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-full border border-zinc-200 px-4 py-1.5 text-xs font-semibold text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
          >
            ← {t("prev")}
          </button>
          <span className="text-xs tabular-nums text-zinc-400">
            {t("page", { page: safePage, pages })}
          </span>
          <button
            type="button"
            disabled={safePage >= pages}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            className="rounded-full border border-zinc-200 px-4 py-1.5 text-xs font-semibold text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
          >
            {t("next")} →
          </button>
        </div>
      ) : null}
    </div>
  );
}
