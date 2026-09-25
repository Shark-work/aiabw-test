"use client";

/**
 * 探索成就 · 徽章面板（roadmap 任务二，2026-09-23）
 *  - 顶部进度条（已解锁 x/8）+ 点击展开徽章列表（解锁条件 / 进度条 / 奖励）
 *  - GET /api/achievements 惰性评估：发现新解锁时弹庆祝动画（积分已到账）
 *  - refreshKey 变化时重新拉取（父面板在每次探索完成后递增）
 *  - 客户端鉴权：localStorage aiabw_token → Bearer；无 token / 401 静默不渲染
 *    （登录引导由父面板 ExploreV2Panel 统一负责）
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Lock,
  Medal,
  PartyPopper,
} from "lucide-react";

import {
  BADGE_I18N_KEYS,
  REWARD_NOTE_BADGES,
  badgeNameMessageKey,
  type BadgeId,
  type NewlyUnlockedBadge,
} from "@/lib/achievements-config";

type BadgeState = {
  id: BadgeId;
  emoji: string;
  rewardPoints: number;
  target: number;
  progress: number;
  unlocked: boolean;
  unlockedAt: string | null;
};

type AchievementsOk = {
  ok: true;
  badges: BadgeState[];
  unlockedCount: number;
  totalCount: number;
  newlyUnlocked: NewlyUnlockedBadge[];
};

export function AchievementPanel({
  refreshKey = 0,
  className = "",
}: {
  refreshKey?: number;
  className?: string;
}) {
  const t = useTranslations("achievements");
  const [data, setData] = useState<AchievementsOk | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [celebration, setCelebration] = useState<NewlyUnlockedBadge[] | null>(
    null,
  );

  const load = useCallback(async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return; // 游客：不渲染（父面板已有登录引导）
    try {
      const res = await fetch("/api/achievements", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.status === 401) return; // token 失效：父面板统一切换登录态
      const json = (await res.json().catch(() => null)) as
        | AchievementsOk
        | { ok: false }
        | null;
      if (json && "ok" in json && json.ok) {
        setData(json);
        if (json.newlyUnlocked.length > 0) setCelebration(json.newlyUnlocked);
      }
    } catch (err) {
      console.error("[AchievementPanel] load failed:", err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!data) return null;
  const pct =
    data.totalCount > 0
      ? Math.round((data.unlockedCount / data.totalCount) * 100)
      : 0;
  const celebrationPoints =
    celebration?.reduce((sum, b) => sum + b.rewardPoints, 0) ?? 0;

  return (
    <section
      className={`overflow-hidden rounded-xl border border-amber-100 bg-white/80 ${className}`}
      data-testid="achievement-panel"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2"
        data-testid="achievement-panel-toggle"
        aria-expanded={expanded}
      >
        <Medal className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="text-xs font-semibold text-zinc-800">
          {t("title")}
        </span>
        <span
          className="text-xs font-bold text-amber-700"
          data-testid="achievement-summary"
        >
          {data.unlockedCount}/{data.totalCount}
        </span>
        <span className="mx-1 h-1.5 min-w-6 flex-1 overflow-hidden rounded-full bg-zinc-100">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        )}
      </button>

      {expanded && (
        <ul
          className="flex flex-col gap-1.5 border-t border-amber-50 px-3 py-2"
          data-testid="achievement-list"
        >
          {data.badges.map((b) => {
            const key = BADGE_I18N_KEYS[b.id];
            const bpct =
              b.target > 0 ? Math.round((b.progress / b.target) * 100) : 0;
            return (
              <li
                key={b.id}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${b.unlocked ? "bg-amber-50/60" : "bg-zinc-50"}`}
                data-testid={`achievement-${b.id}`}
              >
                <span
                  className={`text-xl ${b.unlocked ? "" : "opacity-40 grayscale"}`}
                >
                  {b.emoji}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800">
                    {t(`badges.${key}.name`)}
                    {b.unlocked ? (
                      <Check className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <Lock className="h-3 w-3 text-zinc-300" />
                    )}
                  </span>
                  <span className="truncate text-[11px] text-zinc-500">
                    {t(`badges.${key}.desc`)}
                  </span>
                  {REWARD_NOTE_BADGES.has(b.id) && (
                    <span className="text-[10px] text-violet-600">
                      {t(`badges.${key}.rewardNote`)}
                    </span>
                  )}
                  <span className="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-200/70">
                    <span
                      className={`block h-full rounded-full ${b.unlocked ? "bg-emerald-500" : "bg-amber-400"}`}
                      style={{ width: `${b.unlocked ? 100 : bpct}%` }}
                    />
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5 text-[10px] text-zinc-500">
                  <span data-testid={`achievement-progress-${b.id}`}>
                    {b.progress}/{b.target}
                  </span>
                  <span className="font-semibold text-amber-700">
                    {t("rewardPoints", { points: b.rewardPoints })}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {celebration && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setCelebration(null)}
          data-testid="achievement-celebration"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <PartyPopper className="mx-auto mb-2 h-8 w-8 text-amber-500" />
            <h3 className="mb-2 text-sm font-bold text-zinc-900">
              {t("celebrationTitle")}
            </h3>
            <ul className="mb-3 flex flex-col gap-1.5">
              {celebration.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-center gap-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-900"
                  data-testid={`celebration-${b.id}`}
                >
                  <span className="text-lg">{b.emoji}</span>
                  {t(badgeNameMessageKey(b.id))}
                </li>
              ))}
            </ul>
            <p className="mb-3 text-xs font-semibold text-emerald-700">
              {t("celebrationPoints", { points: celebrationPoints })}
            </p>
            <button
              type="button"
              onClick={() => setCelebration(null)}
              className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-pink-500 px-3 py-2 text-sm font-semibold text-white transition hover:from-orange-600 hover:to-pink-600"
              data-testid="achievement-celebration-close"
            >
              {t("celebrationButton")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default AchievementPanel;

