import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PublicWallShareButton } from "@/components/exploration-v2/public-wall-share-button";
import { ensureDbSchemaOnce } from "@/db/client";
import { POSTCARD_SETS } from "@/lib/postcard-config";
import { getPublicPostcardWall } from "@/server/queries/postcard-wall-queries";

/**
 * /[locale]/postcard-wall/[userId] — 明信片墙公开页（P2 社交传播 · 改动二）
 *
 * 按系列分组展示收集进度：已获得卡片（稀有特效边框）+ 未获得 "?" 占位；
 * 集齐系列金边框 + 「图鉴完成」标识；底部「分享我的明信片墙」生成 OG 汇总图。
 * 隐私门：用户未在设置中开启「公开明信片墙」（默认关）→ 404，不泄露开关状态。
 * robots noindex 避免 SEO 污染。
 */

const RARITY_FRAME: Record<string, string> = {
  common: "border-zinc-200 dark:border-zinc-700",
  rare: "border-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.35)] dark:border-sky-600",
  epic: "border-violet-400 shadow-[0_0_12px_rgba(139,92,246,0.4)] dark:border-violet-600",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; userId: string }>;
}): Promise<Metadata> {
  const { userId } = await params;
  await ensureDbSchemaOnce();
  const wall = await getPublicPostcardWall(userId).catch(() => null);
  return {
    title: wall ? `${wall.owner.username} · Postcard Wall` : "Postcard Wall",
    robots: { index: false, follow: false },
  };
}


export default async function PublicPostcardWallPage({
  params,
}: {
  params: Promise<{ locale: string; userId: string }>;
}) {
  const { locale, userId } = await params;
  setRequestLocale(locale);
  await ensureDbSchemaOnce();
  const wall = await getPublicPostcardWall(userId).catch(() => null);
  if (!wall) notFound();

  const t = await getTranslations("explorationV2.postcardWall");
  const isEn = locale === "en";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="text-center">
        <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-600 dark:bg-rose-950/50 dark:text-rose-300">
          {t("publicBadge")}
        </span>
        <h1 className="mt-3 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          {t("publicTitle", { name: wall.owner.username })}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {t("totalLine", { n: wall.cards.length })}
        </p>
      </header>

      {/* 按系列分组 */}
      <div className="mt-8 space-y-6">
        {POSTCARD_SETS.map((set) => {
          const col = wall.collections.find((c) => c.category === set.category);
          const owned = col?.owned ?? 0;
          const total = col?.total ?? 0;
          const complete = !!col?.complete;
          const cards = wall.cards.filter((c) => c.category === set.category);
          const missing = Math.max(0, total - owned);
          return (
            <section
              key={set.category}
              className={`rounded-2xl border-2 bg-white/90 p-4 shadow-sm dark:bg-zinc-900/80 ${
                complete
                  ? "border-amber-400 shadow-[0_0_16px_rgba(245,158,11,0.3)]"
                  : "border-zinc-200 dark:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
                  {set.emoji} {isEn ? set.labelEn : set.labelZh}
                </h2>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    complete
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {complete ? t("completeBadge") : `${owned}/${total}`}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                {cards.map((c) => (
                  <div
                    key={c.id}
                    title={c.description}
                    className={`rounded-xl border-2 bg-zinc-50 p-2.5 text-center dark:bg-zinc-800/60 ${
                      RARITY_FRAME[c.rarity] ?? RARITY_FRAME.common
                    }`}
                  >
                    <div className="text-2xl">{c.emoji}</div>
                    <div className="mt-1 line-clamp-2 text-[11px] font-medium leading-4 text-zinc-600 dark:text-zinc-300">
                      {c.title}
                    </div>
                  </div>
                ))}
                {/* 未获得占位符 */}
                {Array.from({ length: missing }).map((_, i) => (
                  <div
                    key={`missing-${i}`}
                    className="flex min-h-[84px] items-center justify-center rounded-xl border-2 border-dashed border-zinc-200 text-xl text-zinc-300 dark:border-zinc-700 dark:text-zinc-600"
                  >
                    ?
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* 分享（生成 OG 汇总图） */}
      <div className="mt-8 text-center">
        <PublicWallShareButton userId={userId} total={wall.cards.length} locale={locale} />
      </div>
    </main>
  );
}
