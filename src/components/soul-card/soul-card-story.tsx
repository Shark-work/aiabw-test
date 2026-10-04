"use client";

/**
 * 灵魂卡「成长故事」区块（详情弹窗内，P1 故事外显）——阶段门控内容：
 *  seed    沉睡引导（每日互动提示）；
 *  sprout  首次成长里程碑（萌芽形态已解锁）；
 *  bloom   探索履历摘要（探索 N 次 · 带回 M 张明信片）；
 *  radiant 完整成长数据（探索/明信片/礼物/知识/奇遇/幸福度）+ 稀有标识。
 * 底部「分享卡」按钮：打开 share.png（服务端渲染卡面图，社交平台传播用）。
 *
 * 数据源 GET /api/soul-cards/[id]/story（仅卡主本人）；
 * 公开访问（非本人/未登录）或拉取失败时数据区静默，仅保留分享入口。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
  RARITY_META,
  normalizeRarity,
  stageForLevel,
} from "@/lib/soul-card-config";
import type { SoulCardDto } from "./soul-card-types";

type StoryDto = {
  mintedAt: string;
  explorationCount: number;
  postcardCount: number;
  giftCount: number;
  knowledgeCount: number;
  rareCount: number;
  lastExploredAt: string | null;
  happiness: number | null;
  petLevel: number | null;
  chatCount: number | null;
  petName: string | null;
};

export function SoulCardStory({
  card,
  locale,
}: {
  card: SoulCardDto;
  locale: string;
}) {
  const t = useTranslations("soulCards");
  const [story, setStory] = useState<StoryDto | null>(null);
  const stage = stageForLevel(card.growthLevel);
  const isEn = locale === "en";

  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    fetch(`/api/soul-cards/${card.id}/story`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.ok && d.story) setStory(d.story as StoryDto);
      })
      .catch(() => {
        /* 成长故事拉取失败不影响弹窗主体 */
      });
  }, [card.id]);

  const rarity = normalizeRarity(card.rarity);
  const rarityMeta = RARITY_META[rarity];

  return (
    <section className="rounded-xl border border-violet-200 p-3 dark:border-violet-800/60">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {t("story.title")}
        </h3>
        <span className="text-xs" title={isEn ? stage.labelEn : stage.labelZh}>
          {stage.emoji}
        </span>
      </div>

      {/* seed：沉睡引导（无需数据） */}
      {stage.id === "seed" ? (
        <p className="text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
          🌰 {t("story.sleepingHint")}
        </p>
      ) : null}

      {/* sprout：首次成长里程碑（无需数据） */}
      {stage.id === "sprout" ? (
        <p className="rounded-lg bg-emerald-50 px-2 py-1.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {t("story.milestoneSprout")}
        </p>
      ) : null}

      {/* bloom：探索履历摘要 */}
      {stage.id === "bloom" && story ? (
        <p className="rounded-lg bg-violet-50 px-2 py-1.5 text-[11px] font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
          🌸{" "}
          {t("story.exploreSummary", {
            count: story.explorationCount,
            postcards: story.postcardCount,
          })}
        </p>
      ) : null}

      {/* radiant：完整成长数据 + 稀有标识 */}
      {stage.id === "radiant" && story ? (
        <div className="space-y-2">
          <ul className="grid grid-cols-2 gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
            <li className="rounded-lg bg-zinc-50 px-2 py-1 dark:bg-zinc-800/60">
              🗺️ {t("story.statsExplorations", { n: story.explorationCount })}
            </li>
            <li className="rounded-lg bg-zinc-50 px-2 py-1 dark:bg-zinc-800/60">
              💌 {t("story.statsPostcards", { n: story.postcardCount })}
            </li>
            <li className="rounded-lg bg-zinc-50 px-2 py-1 dark:bg-zinc-800/60">
              🎁 {t("story.statsGifts", { n: story.giftCount })}
            </li>
            <li className="rounded-lg bg-zinc-50 px-2 py-1 dark:bg-zinc-800/60">
              📖 {t("story.statsKnowledge", { n: story.knowledgeCount })}
            </li>
            <li className="rounded-lg bg-zinc-50 px-2 py-1 dark:bg-zinc-800/60">
              ✨ {t("story.statsRare", { n: story.rareCount })}
            </li>
            {story.happiness != null ? (
              <li className="rounded-lg bg-zinc-50 px-2 py-1 dark:bg-zinc-800/60">
                💛 {t("story.statsHappiness", { n: story.happiness })}
              </li>
            ) : null}
          </ul>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold">
            <span>🏅</span>
            <span className={rarityMeta.badgeClass + " rounded-full px-2 py-0.5"}>
              {rarityMeta.emoji} {isEn ? rarityMeta.labelEn : rarityMeta.labelZh}
            </span>
            <span className="text-zinc-400">· {t("story.rareMark")}</span>
          </p>
        </div>
      ) : null}

      {/* bloom/radiant 数据加载中（或公开访问无数据）时的占位 */}
      {(stage.id === "bloom" || stage.id === "radiant") && !story ? (
        <p className="text-[11px] text-zinc-300 dark:text-zinc-600">…</p>
      ) : null}

      {/* 分享卡（服务端渲染卡面图；所有阶段可用） */}
      <a
        href={`/api/soul-cards/${card.id}/share.png`}
        target="_blank"
        rel="noreferrer"
        title={t("share.hint")}
        className="mt-2.5 block rounded-full border border-violet-300 py-1.5 text-center text-xs font-semibold text-violet-600 transition hover:bg-violet-50 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-950/40"
      >
        {t("share.button")}
      </a>
    </section>
  );
}
