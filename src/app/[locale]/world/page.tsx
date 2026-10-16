import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { SoulTreeEgg } from "@/components/world/soul-tree";
import { getStoriesByKind, type CmsStory } from "@/lib/cms/loaders";
import { SITE_URL, ogShareFields } from "@/lib/site";

type Props = { params: Promise<{ locale: string }> };

/**
 * /world · 艾比大陆世界观百科页（2026-10-16；2026-10-18 接线 CMS）
 *  - 五板块：创世神话 / 大陆地图（8 区域卡）/ 生命形态（凡兽·灵宠·古灵）/
 *    五大信条 / 概念辞典（6 词条）；
 *  - 数据源：CMS Stories Collection 经 getStoriesByKind（60s 缓存 + ISR 60s），
 *    空表/未配置自动回退 worldview-data.ts 硬编码——「改表即改站」，后台编辑
 *    一分钟内生效；种子落库口径另由 GET /api/world 对外提供；
 *  - 灵魂树彩蛋（产出物 5）：页面顶部与首页各挂一颗。
 */
export const revalidate = 60;

/** CmsStory.extra 的类型化读取（kind 特有负载，缺省空对象）。 */
const extraOf = (s: CmsStory): Record<string, string | undefined> =>
  (s.extra ?? {}) as Record<string, string | undefined>;
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations("worldview");
  return {
    title: t("pageTitle"),
    description: t("pageSubtitle"),
    openGraph: {
      title: t("pageTitle"),
      description: t("pageSubtitle"),
      type: "website",
      url: `${SITE_URL}/${locale}/world`,
      ...ogShareFields(locale),
    },
  };
}

export default async function WorldPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("worldview");
  const tp = await getTranslations("pages");
  const en = locale === "en";

  // CMS 数据源（带降级链：空表/未配置回退硬编码，渲染形状统一 CmsStory）
  const [regions, lifeForms, creeds, glossary] = await Promise.all([
    getStoriesByKind("region"),
    getStoriesByKind("life-form"),
    getStoriesByKind("creed"),
    getStoriesByKind("glossary"),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="text-center">
        <h1 className="text-2xl font-black tracking-tight text-zinc-900 sm:text-3xl">
          {t("pageTitle")}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">{t("pageSubtitle")}</p>
        {/* 灵魂树彩蛋（产出物 5）：创世短文案 + 大陆统计 + 树叶飘落动画 */}
        <div className="mt-4 flex justify-center">
          <SoulTreeEgg />
        </div>
      </header>

      {/* 板块一 · 创世神话（叙事文案 + 装饰性插图区域） */}
      <section className="mt-10">
        <h2 className="text-lg font-bold text-zinc-900">{t("creationTitle")}</h2>
        {/* 装饰性插图区域：无光之海 → 种子坠落 → 光片四散（CSS 渐变 + emoji 占位，
            正式立绘素材后续替换；animate-pulse 模拟星光闪烁） */}
        <div
          aria-hidden
          className="relative mt-3 overflow-hidden rounded-3xl bg-gradient-to-b from-indigo-950 via-violet-900 to-amber-100 px-6 py-10 text-center shadow-inner"
        >
          <span className="absolute left-[12%] top-[18%] animate-pulse text-lg" style={{ animationDelay: "0.2s" }}>✨</span>
          <span className="absolute right-[16%] top-[30%] animate-pulse text-sm" style={{ animationDelay: "0.9s" }}>✨</span>
          <span className="absolute left-[30%] top-[55%] animate-pulse text-xs" style={{ animationDelay: "1.4s" }}>✨</span>
          <span className="absolute right-[32%] top-[62%] animate-pulse text-lg" style={{ animationDelay: "0.5s" }}>✨</span>
          <span className="absolute left-[48%] top-[12%] animate-pulse text-xs" style={{ animationDelay: "1.1s" }}>✨</span>
          <p className="text-4xl">🌌</p>
          <p className="mt-1 animate-bounce text-3xl">🌱</p>
          <p className="mt-1 text-3xl">🌳</p>
          <p className="mt-2 text-[11px] font-medium uppercase tracking-widest text-violet-200/80">
            Aibi Seed · Soul Tree
          </p>
        </div>
        <div className="mt-4 space-y-3 rounded-2xl border border-zinc-100 bg-white/70 p-5 text-sm leading-relaxed text-zinc-700 shadow-sm">
          <p>{t("creationP1")}</p>
          <p>{t("creationP2")}</p>
        </div>
      </section>

      {/* 板块二 · 大陆地图（卡片式布局：8 大区域） */}
      <section className="mt-12">
        <h2 className="text-lg font-bold text-zinc-900">{t("mapTitle")}</h2>
        <p className="mt-1 text-xs text-zinc-400">{t("mapSubtitle")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {regions.map((r) => {
            const x = extraOf(r);
            return (
              <article
                key={r.slug}
                className="flex flex-col rounded-2xl border border-zinc-100 bg-white/80 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  <span className="text-2xl" aria-hidden>{r.emoji}</span>
                  <div>
                    <h3 className="text-sm font-bold text-zinc-900">{en ? r.titleEn : r.titleZh}</h3>
                    <p className="text-[11px] text-zinc-400">{en ? x.typeEn : x.typeZh}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-600">
                    {t("elementLabel")} · {en ? x.elementEn : x.elementZh}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-zinc-500">
                  <span className="font-semibold text-zinc-600">{t("representativesLabel")}：</span>
                  {en ? x.representativesEn : x.representativesZh}
                </p>
                <p className="mt-2 flex-1 text-xs leading-relaxed text-zinc-600">
                  {en ? r.summaryEn : r.summaryZh}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      {/* 板块三 · 生命形态（凡兽 / 灵宠 / 古灵 对比） */}
      <section className="mt-12">
        <h2 className="text-lg font-bold text-zinc-900">{t("lifeFormsTitle")}</h2>
        <p className="mt-1 text-xs text-zinc-400">{t("lifeFormsSubtitle")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {lifeForms.map((f) => {
            const x = extraOf(f);
            return (
              <article
                key={f.slug}
                className="rounded-2xl border border-zinc-100 bg-white/80 p-4 shadow-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="text-2xl" aria-hidden>{f.emoji}</span>
                  <div>
                    <h3 className="text-sm font-bold text-zinc-900">{en ? f.titleEn : f.titleZh}</h3>
                    <p className="text-[11px] text-zinc-400">{en ? x.subtitleEn : x.subtitleZh}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-zinc-600">
                  {en ? f.summaryEn : f.summaryZh}
                </p>
                <p className="mt-3 rounded-xl bg-zinc-50 px-3 py-2 text-[11px] text-zinc-500">
                  <span className="font-semibold text-zinc-600">{t("examplesLabel")}：</span>
                  {en ? x.examplesEn : x.examplesZh}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      {/* 板块四 · 五大信条（共鸣/探索/收藏/羁绊/传承） */}
      <section className="mt-12">
        <h2 className="text-lg font-bold text-zinc-900">{t("valuesTitle")}</h2>
        <p className="mt-1 text-xs text-zinc-400">{t("valuesSubtitle")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {creeds.map((v) => {
            const x = extraOf(v);
            return (
              <article
                key={v.slug}
                className="flex flex-col rounded-2xl border border-zinc-100 bg-white/80 p-4 text-center shadow-sm"
              >
                <span className="text-2xl" aria-hidden>{v.emoji}</span>
                <h3 className="mt-1 text-sm font-bold text-zinc-900">{en ? v.titleEn : v.titleZh}</h3>
                <blockquote className="mt-2 flex-1 text-[11px] italic leading-relaxed text-zinc-500">
                  「{en ? x.sloganEn : x.sloganZh}」
                </blockquote>
                <p className="mt-2 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-600">
                  {t("featureLabel")} · {en ? v.summaryEn : v.summaryZh}
                </p>
              </article>
            );
          })}
        </div>
      </section>



      {/* 板块五 · 概念辞典（6 词条） */}
      <section className="mt-12">
        <h2 className="text-lg font-bold text-zinc-900">{t("glossaryTitle")}</h2>
        <p className="mt-1 text-xs text-zinc-400">{t("glossarySubtitle")}</p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {glossary.map((g) => (
            <div
              key={g.slug}
              className="rounded-2xl border border-zinc-100 bg-white/80 p-4 shadow-sm"
            >
              <dt className="flex items-center gap-2 text-sm font-bold text-zinc-900">
                <span aria-hidden>{g.emoji}</span>
                {en ? g.titleEn : g.titleZh}
              </dt>
              <dd className="mt-2 text-xs leading-relaxed text-zinc-600">
                {en ? g.summaryEn : g.summaryZh}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 底部 CTA：回到冒险 */}
      <footer className="mt-12 flex flex-wrap items-center justify-center gap-3 border-t border-zinc-100 pt-6">
        <Link
          href="/"
          className="rounded-full border border-zinc-200 bg-white/80 px-5 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
        >
          {tp("backHome")}
        </Link>
        <Link
          href="/explore-v2"
          className="rounded-full bg-orange-500 px-5 py-2 text-sm font-semibold text-white shadow transition hover:bg-orange-600"
        >
          {en ? "🗺️ Start Exploring" : "🗺️ 开始探索"}
        </Link>
      </footer>
    </main>
  );
}
