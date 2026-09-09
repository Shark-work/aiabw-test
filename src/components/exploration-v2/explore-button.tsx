"use client";

/**
 * 探索 v2 · 探索按钮
 *  - 显示今日已用 / 今日上限
 *  - 触发 /api/exploration/start，成功后通过 onResult 回调把结果传给父组件
 *  - 次数用尽：显示「升级 VIP」引导
 */

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, Lock, Compass } from "lucide-react";

export type ExploreResultPayload = {
  eventId: string;
  eventType: string;
  title: string;
  description: string;
  emoji: string | null;
  rarity: "common" | "rare" | "epic";
  isRare: boolean;
  steps: number;
  distance: number;
  knowledge: {
    id: string;
    species: string;
    category: string;
    origin: string | null;
    lifespan: string | null;
    weight: string | null;
    traits: string[];
    funFacts: string[];
    habitat: string | null;
    diet: string | null;
    conservationStatus: string | null;
  } | null;
  todayCount: number;
  maxCount: number;
  isVip: boolean;
};

export type ExploreButtonProps = {
  initialTodayCount: number;
  initialMaxCount: number;
  initialIsVip: boolean;
  onResult: (result: ExploreResultPayload) => void;
  onLimit?: (info: { todayCount: number; maxCount: number; isVip: boolean }) => void;
  className?: string;
};

export function ExploreButton({
  initialTodayCount,
  initialMaxCount,
  initialIsVip,
  onResult,
  onLimit,
  className = "",
}: ExploreButtonProps) {
  const t = useTranslations("explorationV2");
  const [todayCount, setTodayCount] = useState(initialTodayCount);
  const [maxCount] = useState(initialMaxCount);
  const [isVip] = useState(initialIsVip);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = Math.max(0, maxCount - todayCount);
  const isFull = remaining <= 0;

  async function handleClick() {
    if (loading) return;
    setError(null);
    if (isFull) {
      onLimit?.({ todayCount, maxCount, isVip });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/exploration/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; event: { id: string; type: string; title: string; description: string; emoji: string | null; rarity: "common" | "rare" | "epic"; isRare: boolean; knowledge: ExploreResultPayload["knowledge"] }; steps: number; distance: number; todayCount: number; maxCount: number; isVip: boolean }
        | { ok: false; code: string; error: string; todayCount: number; maxCount: number; isVip: boolean }
        | null;
      if (!data) { setError(t("networkError")); return; }
      if (!data.ok) {
        if (data.code === "SIGN_IN_REQUIRED") setError(t("signInFirst"));
        else if (data.code === "EXPLORATION_LIMIT") {
          setTodayCount(data.todayCount);
          onLimit?.({ todayCount: data.todayCount, maxCount: data.maxCount, isVip: data.isVip });
        } else setError(data.error || t("startFailed"));
        return;
      }
      setTodayCount(data.todayCount);
      onResult({
        eventId: data.event.id,
        eventType: data.event.type,
        title: data.event.title,
        description: data.event.description,
        emoji: data.event.emoji,
        rarity: data.event.rarity,
        isRare: data.event.isRare,
        steps: data.steps,
        distance: data.distance,
        knowledge: data.event.knowledge ?? null,
        todayCount: data.todayCount,
        maxCount: data.maxCount,
        isVip: data.isVip,
      });
    } catch (e) {
      console.error("ExploreButton fetch failed:", e);
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className={`flex flex-col items-stretch gap-2 ${className}`} data-testid="explore-button">
      <div className="flex items-center justify-between rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 px-3 py-1.5 text-xs text-amber-900">
        <span className="flex items-center gap-1">
          <Compass className="h-3.5 w-3.5" />
          {t("remainingLabel", { remaining, max: maxCount })}
        </span>
        {isVip ? (
          <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold">💎 VIP</span>
        ) : (
          <span className="text-[10px] text-amber-700">FREE</span>
        )}
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
          isFull ? "bg-zinc-200 text-zinc-600" : "bg-gradient-to-r from-orange-500 to-pink-500 text-white hover:from-orange-600 hover:to-pink-600"
        }`}
        data-testid="explore-button-trigger"
      >
        {loading ? (
          <><Sparkles className="h-4 w-4 animate-spin" />{t("exploring")}</>
        ) : isFull ? (
          <><Lock className="h-4 w-4" />{isVip ? t("vipExhausted") : t("freeExhausted")}</>
        ) : (
          <><Sparkles className="h-4 w-4" />{t("startExplore")}</>
        )}
      </button>
      {isFull && !isVip && (
        <Link
          href="/subscribe"
          className="rounded-lg bg-amber-100 px-3 py-1.5 text-center text-xs font-semibold text-amber-800 transition hover:bg-amber-200"
          data-testid="explore-button-upgrade"
        >
          {t("upgradeHint")}
        </Link>
      )}
      {isFull && isVip && (
        <p className="rounded-lg bg-zinc-100 px-3 py-1.5 text-center text-xs text-zinc-600">{t("vipTomorrowHint")}</p>
      )}
      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-1.5 text-center text-xs text-rose-700">{error}</p>
      )}
    </div>
  );
}

export default ExploreButton;
