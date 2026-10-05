import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SoulCardView } from "@/components/soul-card/soul-card-view";
import type { SoulCardDto } from "@/components/soul-card/soul-card-types";
import { ensureDbSchemaOnce } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { soulQuoteFor } from "@/lib/soul-card-config";
import { findSoulCardById } from "@/server/repositories/soul-card-repository";

/**
 * /[locale]/soul-cards/[id]/public — 灵魂卡公开页（P2 社交传播）
 *
 * 分享链接落点：只读卡面预览（不可操作）+ 全球唯一编号 + 灵魂箴言 +
 * 「我也要唤醒」CTA → 注册页。公开读口径与 share.png 一致（卡面字段即公开凭证内容，
 * 不含任何用户隐私字段）；已销毁/不存在 → 404。robots noindex 避免 SEO 污染。
 */

async function loadActiveCard(id: string) {
  await ensureDbSchemaOnce();
  const card = await findSoulCardById(id).catch(() => null);
  return card && card.status === "active" ? card : null;
}

/** repository 行（Date）→ 前端 DTO（ISO string），仅做序列化形态转换。 */
function toDto(card: NonNullable<Awaited<ReturnType<typeof loadActiveCard>>>): SoulCardDto {
  return {
    ...card,
    status: card.status === "burned" ? "burned" : "active",
    aiPersonality: (card.aiPersonality ?? {}) as SoulCardDto["aiPersonality"],
    mintedAt: card.mintedAt.toISOString(),
    burnedAt: card.burnedAt ? card.burnedAt.toISOString() : null,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const card = await loadActiveCard(id);
  return {
    title: card ? `${card.name} · ${card.certificateNo}` : "Soul Card",
    robots: { index: false, follow: false },
  };
}

export default async function SoulCardPublicPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const card = await loadActiveCard(id);
  if (!card) notFound();

  const t = await getTranslations("soulCards.public");
  const quote = soulQuoteFor(card.certificateNo, locale);

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col items-center gap-4 px-4 py-10">
      <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
        {t("badge")}
      </span>
      {/* 只读卡面（不传 onClick，不可操作） */}
      <div className="w-full">
        <SoulCardView card={toDto(card)} locale={locale} />
      </div>
      <p className="text-center text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        {locale === "en" ? `"${quote}"` : `「${quote}」`}
      </p>
      <p className="font-mono text-sm font-semibold tracking-widest text-violet-600 dark:text-violet-300">
        {card.certificateNo}
      </p>
      <Link
        href="/register"
        className="mt-2 w-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3 text-center text-sm font-bold text-white shadow-md transition hover:opacity-90"
      >
        {t("cta")}
      </Link>
      <p className="text-center text-xs leading-5 text-zinc-400">{t("hint")}</p>
    </main>
  );
}
