import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { pool } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { NewsCoverImage } from "@/components/news-cover-image";
import { formatHot } from "@/lib/news";
import { SITE_URL } from "@/lib/site";

type Props = { params: Promise<{ locale: string; id: string }> };

const FALLBACK_COVER = "/resources/pet/fox2.webp";

function formatTime(ms: number, locale: string): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleString(locale === "en" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 新闻详情页 /news/[id]（站内阅读 + SEO 落地页）：
 *  - 服务端查 hotnews by id（status='visible'），不存在 → notFound；
 *  - 渲染：标题/来源标识/发布时间/封面图/正文（content 优先，空则回退 desc）；
 *  - 有 url → 底部「阅读原文」新标签打开原文；无 url → 站内正文即完整内容。
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  try {
    const { rows } = await pool.query(
      `SELECT title, source, timestamp FROM hotnews WHERE id = $1 AND status = 'visible' LIMIT 1`,
      [Number(id)],
    );
    const n = rows[0];
    if (!n) return {};
    const headline = String(n.title);
    const title =
      locale === "en"
        ? `${headline.slice(0, 40)} - Animal News | AIABW`
        : `${headline.slice(0, 40)} - 动物新闻热榜 | 艾比世界`;
    const time = formatTime(Number(n.timestamp), locale);
    const description =
      locale === "en"
        ? `${headline.slice(0, 80)} (via ${String(n.source)}${time ? `, ${time}` : ""})`
        : `${headline.slice(0, 80)}（来源 ${String(n.source)}${time ? `，发布于 ${time}` : ""}）`;
    return {
      title,
      description: description.slice(0, 160),
      openGraph: { title, description, type: "article", url: `${SITE_URL}/${locale}/news/${Number(id)}` },
    };
  } catch {
    return {};
  }
}

export default async function NewsDetailPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("seo");
  const th = await getTranslations("home");

  const { rows } = await pool.query(
    `SELECT id, source, title, "desc", content, cover, hot, timestamp, url, is_domestic AS "isDomestic"
       FROM hotnews WHERE id = $1 AND status = 'visible' LIMIT 1`,
    [Number(id)],
  );
  const n = rows[0];
  if (!n) notFound();

  const headline = String(n.title);
  const source = String(n.source);
  const isDomestic = !!n.isDomestic;
  const url = n.url ? String(n.url) : null;
  const cover = n.cover ? String(n.cover) : null;
  const content = n.content ? String(n.content) : null;
  const desc = n.desc ? String(n.desc) : null;
  const publishedMs = Number(n.timestamp);
  const time = formatTime(publishedMs, locale);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline,
    image: cover ?? `${SITE_URL}${FALLBACK_COVER}`,
    datePublished: publishedMs > 0 ? new Date(publishedMs).toISOString() : new Date().toISOString(),
    dateModified: new Date().toISOString(),
    author: { "@type": "Organization", name: "艾比世界" },
    publisher: {
      "@type": "Organization",
      name: "艾比世界",
      logo: { "@type": "ImageObject", url: `${SITE_URL}/icon.svg` },
    },
    sourceOrganization: { "@type": "Organization", name: source },
    mainEntityOfPage: `${SITE_URL}/${locale}/news/${Number(n.id)}`,
    articleBody: (content ?? desc ?? headline).slice(0, 200),
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 sm:p-6">
      {/* NewsArticle 结构化数据（SEO：搜索结果展示新闻标签/时间/来源） */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="mx-auto max-w-3xl">
        <Link href="/news" className="text-xs text-zinc-500 transition hover:text-orange-600">
          {t("newsDetailBack")}
        </Link>

        <article className="mt-3 rounded-2xl border border-zinc-200 bg-white/90 p-6 shadow-sm backdrop-blur">
          <h1 className="text-xl font-bold leading-snug text-zinc-900">{headline}</h1>

          {/* 来源标识 + 发布时间 + 热度 */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium">
              {isDomestic ? th("newsDomesticLabel") : th("newsGlobalLabel")}
            </span>
            <span className="rounded-full bg-orange-50 px-2 py-0.5 font-semibold text-orange-600">
              {t("newsSourceLabel")} {source}
            </span>
            {time && <span>{t("newsPublishedAt", { time })}</span>}
            <span>🔥 {formatHot(Number(n.hot))}</span>
          </div>
          {/* 翻译提示：国外新闻 AI 翻译透明化 */}
          {!isDomestic && locale === "zh" && (
            <p className="mt-1 text-[10px] text-zinc-400">
              {th("newsTranslatedFrom", { source })}
            </p>
          )}

          {/* 封面图（外链失败自动回退站内占位图） */}
          {cover && (
            <NewsCoverImage
              src={cover}
              alt={headline}
              className="mt-4 h-52 w-full rounded-xl border border-zinc-100 object-cover"
            />
          )}

          {/* 站内正文：content 优先，空则回退 desc；均无则只显示标题 */}
          <p className="mt-4 whitespace-pre-line text-[15px] leading-7 text-zinc-700">
            {content ?? desc ?? headline}
          </p>

          {/* 底部：有 url → 阅读原文（新标签）；无 url → 站内正文即完整内容 */}
          {url ? (
            <div className="mt-6 border-t border-zinc-100 pt-4">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-orange-600"
              >
                {t("newsReadOriginal")}
              </a>
            </div>
          ) : (
            <p className="mt-5 border-t border-zinc-100 pt-4 text-[11px] text-zinc-400">
              {th("newsInSiteFullText")}
            </p>
          )}
        </article>

        <p className="mt-3 text-[11px] leading-snug text-slate-400">{th("newsCopyright")}</p>
      </div>
    </main>
  );
}

