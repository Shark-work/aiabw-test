"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

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

const FALLBACK_COVER = "/resources/pet/fox2.webp";
const INTERVAL_MS = 5000;

/** 热度标签格式化：≥10000 显示 x.xw，≥100 取整，<100 保留一位小数。 */
function formatHot(hot: number): string {
  if (hot >= 10000) return (hot / 10000).toFixed(1) + "w";
  if (hot >= 100) return String(Math.round(hot));
  return hot.toFixed(1);
}

/**
 * 「🐾 动物世界头条」首页轮播：
 *  - Top 5 新闻（/api/news/hot，缓存 60s）；
 *  - 每 5 秒自动切换，鼠标悬停暂停，点击卡片在新标签打开原文；
 *  - 封面缩略图（防盗链失败自动回退占位图）+ 标题 + 热度标签；
 *  - 底部版权声明小字；接口失败静默隐藏。
 */
export function NewsCarousel() {
  const t = useTranslations("home");
  const locale = useLocale();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/news/hot?locale=${locale}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.ok && Array.isArray(d.news) && d.news.length) setNews(d.news);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 自动轮播：每 5s 切换（悬停暂停）
  useEffect(() => {
    if (paused || !news.length) return;
    timerRef.current = setInterval(() => setIdx((i) => (i + 1) % news.length), INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [paused, news.length]);

  if (!news.length) return null;
  const item = news[idx];

  return (
    <section className="w-full rounded-2xl border border-zinc-200 bg-white/85 p-6 shadow-sm backdrop-blur">
      <h3 className="mb-2 text-sm font-semibold text-zinc-800">{t("newsTitle")}</h3>
      <div
        className="overflow-hidden rounded-xl"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* 当前新闻大卡片（Featured News Card）：移动端图上文下，桌面图左文右 */}
        <a
          key={item.id}
          href={item.url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex flex-col overflow-hidden rounded-xl border border-zinc-100 bg-white transition hover:border-orange-300 hover:shadow-md sm:flex-row"
        >
          {/* 高清封面图：移动端全宽（h-44），桌面左侧半宽 */}
          {/* 远程新闻域名不可控（next/image 需逐一配置 remotePatterns 且不支持 onError 回退），保留原生 img。 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.cover ?? FALLBACK_COVER}
            alt={item.title}
            loading="lazy"
            className="h-44 w-full shrink-0 object-cover sm:h-52 sm:w-1/2"
            onError={(e) => {
              const el = e.currentTarget;
              if (el.src !== window.location.origin + FALLBACK_COVER) el.src = FALLBACK_COVER;
            }}
          />
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 p-4">
            <p className="line-clamp-2 text-lg font-bold leading-snug text-zinc-900 transition group-hover:text-orange-600 sm:text-xl">
              {item.title}
            </p>
            {/* 翻译提示：国外新闻 AI 翻译透明化 */}
            {item.isDomestic === false && locale === "zh" && (
              <p className="text-[10px] text-zinc-400">
                {t("newsTranslatedFrom", { source: item.source })}
              </p>
            )}
            <p className="flex items-center gap-1.5 text-xs text-zinc-400">
              <span className="shrink-0 rounded bg-zinc-100 px-1 py-0.5 text-[10px] font-medium">
                {item.isDomestic ? t("newsDomesticLabel") : t("newsGlobalLabel")}
              </span>
              <span className="line-clamp-1">{item.source}</span>
            </p>
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-600">
              🔥 {t("newsHot", { hot: formatHot(item.hot) })}
            </span>
          </div>
        </a>
      </div>

      {/* 轮播指示点 + 手动切换 */}
      <div className="mt-2 flex items-center justify-center gap-1.5">
        {news.map((n, i) => (
          <button
            key={n.id}
            type="button"
            aria-label={`news ${i + 1}`}
            onClick={() => setIdx(i)}
            className={`h-1.5 rounded-full transition-all ${i === idx ? "w-4 bg-orange-400" : "w-1.5 bg-zinc-200 hover:bg-zinc-300"}`}
          />
        ))}
      </div>

      {/* 版权声明（合规） */}
      <p className="mt-2 text-center text-[10px] leading-snug text-slate-400">
        {t("newsCopyright")}
      </p>
    </section>
  );
}
