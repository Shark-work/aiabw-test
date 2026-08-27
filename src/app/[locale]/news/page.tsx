import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { pool } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { formatHot } from "@/lib/news";
import { SITE_URL } from "@/lib/site";

type Props = { params: Promise<{ locale: string }> };

/**
 * 动物新闻热榜 — SEO 落地页：
 *  - 动态 generateMetadata：Top1 新闻标题/来源进入 description（长尾关键词）；
 *  - 服务端渲染 Top10 新闻列表（利于收录），链接新标签打开原文；
 *  - URL 已纳入 sitemap.xml（/zh|en/news）。
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations("seo");
  const title = t("newsTitle");
  let description = t("newsDescFallback");
  try {
    const { rows } = await pool.query(
      `SELECT title, source FROM hotnews ORDER BY hot DESC LIMIT 1`,
    );
    const top = rows[0];
    if (top) {
      description = t("newsDesc", {
        top: String(top.title).slice(0, 60),
        source: String(top.source),
      }).slice(0, 160);
    }
  } catch {
    // 库不可达：使用兜底描述
  }
  return {
    title,
    description,
    openGraph: { title, description, type: "website", url: `${SITE_URL}/${locale}/news` },
  };
}

export default async function NewsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("seo");
  const th = await getTranslations("home");

  let news: { id: number; source: string; title: string; hot: number; url: string | null }[] = [];
  try {
    const { rows } = await pool.query(
      `SELECT id, source, title, hot, url FROM hotnews ORDER BY hot DESC LIMIT 10`,
    );
    news = rows.map((r) => ({
      id: Number(r.id),
      source: String(r.source),
      title: String(r.title),
      hot: Number(r.hot),
      url: r.url ? String(r.url) : null,
    }));
  } catch {
    // 库不可达：空列表
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-xl font-semibold text-zinc-900">{t("newsListTitle")}</h1>

        {news.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-400">{t("newsListEmpty")}</p>
        ) : (
          <ol className="mt-4 divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm backdrop-blur">
            {news.map((n, i) => (
              <li key={n.id} className="py-3 first:pt-0 last:pb-0">
                <a
                  href={n.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-3"
                >
                  <span className="mt-0.5 w-5 shrink-0 text-sm font-bold text-zinc-300">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/news/${n.id}`}
                      className="line-clamp-2 text-sm font-medium leading-snug text-zinc-800 transition group-hover:text-orange-600"
                    >
                      {n.title}
                    </Link>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
                      <span className="line-clamp-1">{n.source}</span>
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

        <p className="mt-3 text-[11px] leading-snug text-slate-400">{th("newsCopyright")}</p>
        <Link href="/" className="mt-4 inline-block text-xs text-zinc-500 transition hover:text-orange-600">
          {t("newsBackHome")}
        </Link>
      </div>
    </main>
  );
}
