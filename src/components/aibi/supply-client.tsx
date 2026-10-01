"use client";

/**
 * SupplyClient · 总量看板（Phase 7 · 8.8，公开）
 *  - 统计卡：当前流通 / 累计增发 / 累计销毁 / 最大供应（链下模拟 = 不封顶）；
 *  - 快照趋势：近 10 条 supply_snapshots 迷你柱图（纯 CSS 高度百分比）；
 *  - 增发/销毁历史：GET /api/aibi/supply?page= 分页（脱敏，不含用户字段）。
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { AibiErrorBanner } from "./aibi-error-banner";
import { aibiFetch, AibiClientError } from "@/lib/aibi-client";
import { aibiCertDisplay, type AibiTokenDto } from "@/lib/aibi-visual";

interface HistoryRow {
  kind: "mint" | "burn";
  aibiTokenId: string;
  speciesId: string;
  source: string | null;
  reason: string | null;
  chainTxHash: string | null;
  supplyAfter: number;
  createdAt: string;
  species: AibiTokenDto["species"];
}

interface SupplyData {
  totalMinted: number;
  totalBurned: number;
  currentSupply: number;
  maxSupply: number | null;
  snapshots: { totalMinted: number; totalBurned: number; currentSupply: number; createdAt: string }[];
  history: { rows: HistoryRow[]; total: number; page: number; pageSize: number };
}

export function SupplyClient() {
  const t = useTranslations("aibi.supplyPage");
  const locale = useLocale();
  const isEn = locale === "en";
  const [data, setData] = useState<SupplyData | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (p: number) => {
      try {
        const d = await aibiFetch<SupplyData>(`/api/aibi/supply?page=${p}&pageSize=20`, { locale });
        setData(d);
      } catch (e) {
        setError(e instanceof AibiClientError ? e.message : t("loadFailed"));
      }
    },
    [locale, t],
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString(isEn ? "en-US" : "zh-CN", { hour12: false });

  const pages = data ? Math.max(1, Math.ceil(data.history.total / data.history.pageSize)) : 1;
  const maxCurrent = Math.max(1, ...(data?.snapshots.map((s) => s.currentSupply) ?? [1]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black text-zinc-900 dark:text-zinc-50">📊 {t("title")}</h1>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
      </div>

      {error ? <AibiErrorBanner message={error} onClose={() => setError(null)} /> : null}

      {/* 统计卡 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("current")} value={data?.currentSupply} accent="text-indigo-600 dark:text-indigo-300" />
        <StatCard label={t("minted")} value={data?.totalMinted} accent="text-emerald-600 dark:text-emerald-300" />
        <StatCard label={t("burned")} value={data?.totalBurned} accent="text-red-500 dark:text-red-300" />
        <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
          <p className="text-[11px] text-zinc-400">{t("maxSupply")}</p>
          <p className="mt-1 text-lg font-black text-zinc-700 dark:text-zinc-200">
            {data ? (data.maxSupply ?? t("maxUnlimited")) : "…"}
          </p>
        </div>
      </div>

      {/* 快照趋势（近 10 条，迷你柱图） */}
      {data && data.snapshots.length > 1 ? (
        <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
          <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">📈 {t("trendTitle")}</h2>
          <div className="mt-3 flex h-20 items-end gap-1.5">
            {data.snapshots.map((s, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-md bg-indigo-400/70 transition-all dark:bg-indigo-500/60"
                style={{ height: `${Math.max(6, Math.round((s.currentSupply / maxCurrent) * 100))}%` }}
                title={`${new Date(s.createdAt).toLocaleDateString(isEn ? "en-US" : "zh-CN")} · ${s.currentSupply}`}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* 增发 / 销毁历史（分页） */}
      <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
        <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
          📜 {t("historyTitle")}（{data?.history.total ?? "…"}）
        </h2>
        {data && data.history.rows.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {data.history.rows.map((r, i) => (
              <li
                key={`${r.aibiTokenId}-${r.kind}-${i}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-800/60"
              >
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${
                    r.kind === "mint" ? "bg-emerald-500" : "bg-red-400"
                  }`}
                >
                  {r.kind === "mint" ? t("eventMint") : t("eventBurn")}
                </span>
                <Link
                  href={`/aibi/${r.aibiTokenId}`}
                  className="font-mono text-[11px] font-semibold text-indigo-500 hover:underline"
                >
                  {aibiCertDisplay(r.aibiTokenId)}
                </Link>
                <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                  {r.species ? (isEn ? r.species.nameEn : r.species.nameZh) : r.speciesId}
                </span>
                <span className="rounded-full bg-zinc-200/70 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300">
                  {r.source ?? r.reason ?? "—"}
                </span>
                <span className="text-zinc-400">{fmtTime(r.createdAt)}</span>
                <span className="ml-auto font-mono text-[10px] text-zinc-400">
                  {t("colSupplyAfter")} {r.supplyAfter}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-400 dark:border-zinc-700">
            {t("empty")}
          </p>
        )}

        {pages > 1 ? (
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-full border border-zinc-200 px-4 py-1.5 text-xs font-semibold text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
            >
              ← {t("prev")}
            </button>
            <span className="text-xs tabular-nums text-zinc-400">{t("page", { page, pages })}</span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              className="rounded-full border border-zinc-200 px-4 py-1.5 text-xs font-semibold text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
            >
              {t("next")} →
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | undefined;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
      <p className="text-[11px] text-zinc-400">{label}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${accent}`}>{value ?? "…"}</p>
    </div>
  );
}
