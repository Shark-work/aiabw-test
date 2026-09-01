"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { formatHot } from "@/lib/news";

type NewsItem = {
  id: number;
  source: string;
  title: string;
  desc: string | null;
  cover: string | null;
  hot: number;
  timestamp: number;
  url: string | null;
  /** 国内/国际（80/20 配比 + 国旗标签） */
  isDomestic?: boolean;
};

const SKELETON_ROWS = 6;

/** 热度竖线配色：Top1 红 → 2 橙 → 3 琥珀 → 其余灰。 */
function hotBarClass(rank: number): string {
  if (rank === 1) return "bg-gradient-to-b from-red-500 to-orange-400";
  if (rank === 2) return "bg-orange-400";
  if (rank === 3) return "bg-amber-400";
  return "bg-zinc-200";
}

/** 排名数字配色：与竖线呼应。 */
function rankTextClass(rank: number): string {
  if (rank === 1) return "text-red-500";
  if (rank === 2) return "text-orange-500";
  if (rank === 3) return "text-amber-500";
  return "text-zinc-400";
}

/**
 * 侧边栏「🔥 动物新闻热榜」（任务二）：
 *  - 数据源 /api/news/animal-feed（Top 10，服务端缓存 60s）；
 *  - 圆角卡片 + 排名 + 热度竖线 + 标题两行省略 + 来源标识 + 🔥 热度；
 *  - 加载中渲染骨架屏（Skeleton），防止白屏；
 *  - 点击条目在新标签打开原文；接口失败 / 无数据时静默隐藏。
 */
export function SidebarAnimalNews() {
  const t = useTranslations("home");
  const ts = useTranslations("seo");
  const locale = useLocale();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/news/animal-feed?locale=${locale}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.ok && Array.isArray(d.news)) setNews(d.news);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="w-full rounded-2xl border border-zinc-200 bg-white/85 p-6 shadow-sm backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-zinc-800">
          {t("newsRankTitle")}
        </h3>
        <Link
          href="/news"
          className="shrink-0 text-[11px] font-medium text-orange-500 transition hover:text-orange-600"
        >
          {ts("viewAll")} →
        </Link>
      </div>

      {/* 骨架屏：防止首屏白屏 */}
      {loading ? (
        <div className="space-y-3" aria-label="loading">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <div className="flex w-6 shrink-0 flex-col items-center">
                <span className="h-3 w-4 animate-pulse rounded bg-zinc-200" />
                <span className="mt-1 h-6 w-0.5 animate-pulse rounded bg-zinc-100" />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-3.5 w-full animate-pulse rounded bg-zinc-200" />
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-zinc-200" />
                <div className="h-2.5 w-1/3 animate-pulse rounded bg-zinc-100" />
              </div>
            </div>
          ))}
        </div>
      ) : news.length === 0 ? null : (
        <ol className="divide-y divide-zinc-100">
          {news.map((n, i) => (
            <li key={n.id} className="py-2.5 first:pt-0 last:pb-0">
              <a
                href={n.url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-2.5"
              >
                {/* 排名 + 热度竖线 */}
                <div className="flex w-6 shrink-0 flex-col items-center">
                  <span className={`text-xs font-bold ${rankTextClass(i)}`}>{i + 1}</span>
                  <span className={`mt-1 h-6 w-0.5 rounded-full ${hotBarClass(i)}`} />
                </div>
                {/* 标题（两行省略）+ 来源标识 + 🔥 热度 */}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[13px] font-medium leading-snug text-zinc-800 transition group-hover:text-orange-600">
                    {n.title}
                  </p>
                  {/* 翻译提示：国外新闻 AI 翻译透明化 */}
                  {n.isDomestic === false && locale === "zh" && (
                    <p className="mt-0.5 text-[10px] text-zinc-400">
                      {t("newsTranslatedFrom", { source: n.source })}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-400">
                    <span className="line-clamp-1 max-w-[9rem]">
                      <span className="rounded bg-zinc-100 px-1 py-0.5 font-medium">
                        {n.isDomestic ? t("newsDomesticLabel") : t("newsGlobalLabel")}
                      </span>{" "}
                      {n.source}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-orange-50 px-1.5 py-0.5 font-semibold text-orange-600">
                      🔥 {formatHot(n.hot)}
                    </span>
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ol>
      )}

      {/* 版权声明（合规） */}
      {!loading && news.length > 0 && (
        <p className="mt-2 text-center text-[10px] leading-snug text-slate-400">
          {t("newsCopyright")}
        </p>
      )}
    </section>
  );
}
