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
 * 新闻详情页 /news/[id]（SEO 落地页）：
 *  - 服务端查 hotnews by id（status='visible'），不存在 → notFound；
 *  - 动态 generateMetadata：headline 进 title，来源+时间进 description；
 *  - 渲染：标题/来源标识/发布时间/封面图（外链回退）/摘要正文/「阅读原文」/「返回列表」；
 *  - 注入 NewsArticle JSON-LD（含 RSS 摘要前 200 字）。
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
    `SELECT id, source, title, "desc", cover, hot, timestamp, url, updated_at AS "updatedAt",
            is_domestic AS "isDomestic"
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
  const body = String(n.desc ?? n.title);
  const publishedMs = Number(n.timestamp);
  const updatedAt = n.updatedAt ? new Date(String(n.updatedAt)) : new Date();
  const time = formatTime(publishedMs, locale);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline,
    image: cover ?? `${SITE_URL}${FALLBACK_COVER}`,
    datePublished: publishedMs > 0 ? new Date(publishedMs).toISOString() : new Date().toISOString(),
    dateModified: updatedAt.toISOString(),
    author: { "@type": "Organization", name: "艾比世界" },
    publisher: {
      "@type": "Organization",
      name: "艾比世界",
      logo: { "@type": "ImageObject", url: `${SITE_URL}/icon.svg` },
    },
    sourceOrganization: { "@type": "Organization", name: source },
    mainEntityOfPage: `${SITE_URL}/${locale}/news/${Number(n.id)}`,
    articleBody: body.slice(0, 200), // RSS 摘要前 200 字
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

          {/* 来源标识（🇨🇳 国内 / 🌍 国际）+ 发布时间 + 热度 */}
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

          <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-zinc-700">{body}</p>

          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-block rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-orange-600"
            >
              {t("newsReadOriginal")}
            </a>
          )}
        </article>

        <p className="mt-3 text-[11px] leading-snug text-slate-400">{th("newsCopyright")}</p>
      </div>
    </main>
  );
}
