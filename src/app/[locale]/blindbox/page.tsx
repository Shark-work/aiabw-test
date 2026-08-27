import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { pool } from "@/db/client";
import { BlindboxPlaza } from "@/components/blindbox-plaza";
import { SITE_URL } from "@/lib/site";

type Props = { params: Promise<{ locale: string }> };

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * 盲盒广场 — SEO 落地页：
 *  - 动态 generateMetadata：查激活奖池，把传说爆率写进标题（转化关键词）；
 *  - 复用客户端 <BlindboxPlaza />（抽奖/开箱/爆率公示交互）；
 *  - URL 已纳入 sitemap.xml（/zh|en/blindbox）。
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations("seo");
  try {
    const { rows } = await pool.query(
      `SELECT probabilities FROM blindbox_pools WHERE is_active = true ORDER BY created_at LIMIT 1`,
    );
    const p = rows[0]?.probabilities as Record<string, number> | undefined;
    const legendary = num(p?.legendary, 1);
    const title = t("blindboxTitle", { legendary: legendary.toFixed(1) });
    const description = t("blindboxDesc", {
      common: num(p?.common, 70),
      rare: num(p?.rare, 20),
      epic: num(p?.epic, 9),
      legendary,
    }).slice(0, 160);
    return {
      title,
      description,
      openGraph: { title, description, type: "website", url: `${SITE_URL}/${locale}/blindbox` },
    };
  } catch {
    return {};
  }
}

export default async function BlindboxPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("seo");

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-xl font-semibold text-zinc-900">🎁 {t("blindboxH1")}</h1>
        <p className="mt-1 text-xs text-zinc-500">{t("blindboxIntro")}</p>
        <div className="mt-4">
          <BlindboxPlaza />
        </div>
      </div>
    </main>
  );
}
