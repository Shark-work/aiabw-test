"use client";

/**
 * ProfileClient · 用户中心（Phase 7 · 8.7，需登录）
 *  - 账号信息：GET /api/auth/me（{ok,user} 旧契约，非 aibiFetch 格式）；
 *  - 钱包 / 持有计数 / 铸造与销毁记录：GET /api/aibi/profile（分页，page 同时驱动两张表）；
 *  - 未登录：登录引导（与背包页同一模式）。
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { AibiErrorBanner } from "./aibi-error-banner";
import { aibiFetch, AibiClientError } from "@/lib/aibi-client";
import { aibiCertDisplay, type AibiTokenDto } from "@/lib/aibi-visual";

interface HistoryRow {
  aibiTokenId: string;
  speciesId: string;
  source?: string;
  reason?: string;
  chainTxHash: string | null;
  supplyAfter: number;
  createdAt: string;
  species: AibiTokenDto["species"];
}

interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

interface ProfileSummary {
  aibiCount: number;
  itemCount: number;
  packCount: number;
  wallet: { walletAddress: string; chainId: string } | null;
  mints: Paged<HistoryRow>;
  burns: Paged<HistoryRow>;
}

export function ProfileClient() {
  const t = useTranslations("aibi.profilePage");
  const locale = useLocale();
  const isEn = locale === "en";
  const [me, setMe] = useState<{ username: string; points: number } | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (p: number) => {
      const token = localStorage.getItem("aiabw_token");
      if (!token) {
        setAuthed(false);
        return;
      }
      setAuthed(true);
      try {
        const meRes = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const meData = await meRes.json();
        if (meData?.ok && meData.user) {
          setMe({ username: meData.user.username ?? "", points: meData.user.points ?? 0 });
        }
        const data = await aibiFetch<ProfileSummary>(`/api/aibi/profile?page=${p}&pageSize=10`, {
          locale,
        });
        setSummary(data);
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

  if (authed === false) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-10 text-center">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("signInHint")}</p>
        <Link
          href="/login"
          className="inline-block rounded-2xl bg-orange-500 px-6 py-2.5 text-sm font-bold text-white"
        >
          {t("signIn")}
        </Link>
      </div>
    );
  }

  const pages = summary
    ? Math.max(1, Math.ceil(Math.max(summary.mints.total, summary.burns.total) / summary.mints.pageSize))
    : 1;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black text-zinc-900 dark:text-zinc-50">👤 {t("title")}</h1>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
      </div>

      {error ? <AibiErrorBanner message={error} onClose={() => setError(null)} /> : null}

      {/* 账号 + 钱包 + 持有计数 */}
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
          <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">🪪 {t("userTitle")}</h2>
          <div className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
            <p>
              {t("username")}：<span className="font-bold">{me?.username ?? "…"}</span>
            </p>
            <p>
              {t("points")}：<span className="font-bold text-amber-600">⭐ {me?.points ?? "…"}</span>
            </p>
          </div>
        </section>
        <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
          <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">👛 {t("walletTitle")}</h2>
          <p className="mt-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
            {summary?.wallet?.walletAddress ?? t("walletNone")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 font-bold text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
              {t("aibiCount")} {summary?.aibiCount ?? "…"}
            </span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-bold text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300">
              {t("itemCount")} {summary?.itemCount ?? "…"}
            </span>
          </div>
        </section>
      </div>

      {/* 铸造 / 销毁记录（分页） */}
      {(
        [
          { key: "mints", title: t("mintHistory"), empty: t("emptyMint"), hist: summary?.mints },
          { key: "burns", title: t("burnHistory"), empty: t("emptyBurn"), hist: summary?.burns },
        ] as const
      ).map(({ key, title, empty, hist }) => (
        <section key={key} className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
          <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
            {key === "mints" ? "🪙" : "🔥"} {title}（{hist?.total ?? "…"}）
          </h2>
          {hist && hist.rows.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {hist.rows.map((r, i) => (
                <li
                  key={`${r.aibiTokenId}-${i}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-800/60"
                >
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
                  <span className="ml-auto text-zinc-400">{fmtTime(r.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-xl border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-400 dark:border-zinc-700">
              {empty}
            </p>
          )}
        </section>
      ))}

      {/* 分页（page 同时驱动铸造/销毁两表，pages 取两者最大） */}
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-3 pt-1">
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
    </div>
  );
}
