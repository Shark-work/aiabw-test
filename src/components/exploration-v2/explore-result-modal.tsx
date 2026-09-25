"use client";

/**
 * 探索 v2 · 探索结果弹窗
 *  - 大 emoji + 标题 + 描述
 *  - 步数/距离奖励 chips
 *  - 知识类事件携带「查看动物知识」按钮
 *  - 稀有度徽章
 */

import { useTranslations } from "next-intl";
import { X, Footprints, MapPin, Sparkles, BookOpen, Trophy } from "lucide-react";

import {
  badgeNameMessageKey,
  type NewlyUnlockedBadge,
} from "@/lib/achievements-config";

export type ExploreResultModalData = {
  emoji: string | null;
  title: string;
  description: string;
  rarity: "common" | "rare" | "epic";
  isRare: boolean;
  steps: number;
  distance: number;
  knowledge: {
    id: string;
    species: string;
    category: string;
  } | null;
  /** 本次探索新解锁的徽章（成就系统，roadmap 任务二；null/undefined = 无） */
  newlyUnlocked?: NewlyUnlockedBadge[] | null;
};

type Props = {
  result: ExploreResultModalData | null;
  onClose: () => void;
  onViewKnowledge?: (knowledgeId: string) => void;
};

const RARITY_TEXT: Record<"common" | "rare" | "epic", string> = {
  common: "Common",
  rare: "Rare ✨",
  epic: "Epic 💎",
};

export function ExploreResultModal({ result, onClose, onViewKnowledge }: Props) {
  const t = useTranslations("explorationV2");
  const ta = useTranslations("achievements");
  if (!result) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      data-testid="explore-result-overlay"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="explore-result-modal"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-full bg-white/80 p-1.5 text-zinc-500 backdrop-blur transition hover:bg-white"
          aria-label="close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="bg-gradient-to-br from-amber-100 via-pink-100 to-rose-100 px-6 pb-4 pt-8 text-center">
          <div
            className="mx-auto mb-2 flex h-20 w-20 items-center justify-center rounded-full bg-white text-5xl shadow-lg"
            data-testid="explore-result-emoji"
          >
            {result.emoji ?? "✨"}
          </div>
          {result.isRare && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">
              <Trophy className="h-3 w-3" />
              {RARITY_TEXT[result.rarity]}
            </span>
          )}
        </div>

        <div className="px-6 py-4">
          <h2
            className="mb-1 text-center text-base font-bold text-zinc-900"
            data-testid="explore-result-title"
          >
            {result.title}
          </h2>
          <p className="mb-4 text-center text-xs text-zinc-600">
            {result.description}
          </p>

          <div className="mb-4 grid grid-cols-2 gap-2">
            <div className="flex items-center justify-center gap-1.5 rounded-lg bg-orange-50 px-2 py-2 text-orange-700">
              <Footprints className="h-4 w-4" />
              <span className="text-sm font-bold" data-testid="explore-result-steps">
                +{result.steps}
              </span>
            </div>
            <div className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-50 px-2 py-2 text-emerald-700">
              <MapPin className="h-4 w-4" />
              <span className="text-sm font-bold" data-testid="explore-result-distance">
                {result.distance.toFixed(2)} km
              </span>
            </div>
          </div>

          {result.newlyUnlocked && result.newlyUnlocked.length > 0 && (
            <div
              className="mb-2 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-3 py-2"
              data-testid="explore-result-badges"
            >
              <p className="mb-1.5 text-center text-xs font-bold text-amber-900">
                {ta("celebrationTitle")}
              </p>
              <ul className="flex flex-col gap-1">
                {result.newlyUnlocked.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-800"
                    data-testid={`explore-result-badge-${b.id}`}
                  >
                    <span className="text-base">{b.emoji}</span>
                    {ta(badgeNameMessageKey(b.id))}
                    <span className="text-emerald-700">
                      {ta("rewardPoints", { points: b.rewardPoints })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.knowledge && (
            <button
              type="button"
              onClick={() => onViewKnowledge?.(result.knowledge!.id)}
              className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-200"
              data-testid="explore-result-view-knowledge"
            >
              <BookOpen className="h-4 w-4" />
              {t("viewKnowledgeCard", {
                species: result.knowledge.species,
              })}
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-pink-500 px-3 py-2 text-sm font-semibold text-white transition hover:from-orange-600 hover:to-pink-600"
            data-testid="explore-result-close"
          >
            <Sparkles className="h-4 w-4" />
            {t("gotIt")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ExploreResultModal;
