"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type NewsItem = {
  id: number;
  source: string;
  title: string;
  desc: string | null;
  cover: string | null;
  hot: number;
  timestamp: number;
  url: string | null;
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
  const [news, setNews] = useState<NewsItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/news/hot")
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
    <section className="w-full rounded-2xl border border-zinc-200 bg-white/85 p-4 shadow-sm backdrop-blur">
      <h3 className="mb-2 text-sm font-semibold text-zinc-800">{t("newsTitle")}</h3>
      <div
        className="overflow-hidden rounded-xl"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* 当前新闻卡片 */}
        <a
          key={item.id}
          href={item.url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-xl border border-zinc-100 bg-white p-3 transition hover:border-orange-300"
        >
          {/* 封面缩略图：远程新闻域名不可控（next/image 需逐一配置 remotePatterns 且不支持 onError 回退），保留原生 img。 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.cover ?? FALLBACK_COVER}
            alt={item.title}
            loading="lazy"
            width={72}
            height={72}
            className="h-[72px] w-[72px] shrink-0 rounded-lg border border-zinc-100 object-cover"
            onError={(e) => {
              const el = e.currentTarget;
              if (el.src !== window.location.origin + FALLBACK_COVER) el.src = FALLBACK_COVER;
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-medium leading-snug text-zinc-800">
              {item.title}
            </p>
            <p className="mt-1 line-clamp-1 text-[11px] text-zinc-400">{item.source}</p>
            <span className="mt-1.5 inline-block rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-600">
              {t("newsHot", { hot: formatHot(item.hot) })}
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
