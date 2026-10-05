"use client";

/**
 * 探索 v2 · 主面板（整合 Timeline + ExploreButton + ResultModal + KnowledgeCard）
 *  - 客户端鉴权（2026-09 修复"已登录仍提示请先登录"）：本站登录态只保存在
 *    localStorage 的 aiabw_token（API 一律 Authorization: Bearer），SSR 读不到，
 *    因此登录门槛必须在客户端判定：
 *      · localStorage 无 token → 登录引导（仅这种情况才显示「请先登录」）
 *      · 有 token → Bearer 拉取 /api/exploration/quota + /history 渲染首屏
 *      · 接口 401 → 清除失效 token → 登录引导
 *  - 任何错误都降级到控制台，不阻塞渲染
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import {
  ExploreButton,
  type ExploreResultPayload,
} from "@/components/exploration-v2/explore-button";
import { KnowledgeCard, type KnowledgeCardData } from "@/components/exploration-v2/knowledge-card";
import { PetTimeline, type TimelineRecord } from "@/components/exploration-v2/pet-timeline";
import {
  ExploreResultModal,
  type ExploreResultModalData,
} from "@/components/exploration-v2/explore-result-modal";
import { PostcardWall } from "@/components/exploration-v2/postcard-wall";
import { AchievementPanel } from "@/components/achievements/achievement-panel";
import { EXPLORATION_REWARD_CONFIG } from "@/lib/exploration-rewards";

type Quota = { todayCount: number; maxCount: number; isVip: boolean; streak: number };
type AuthState = "loading" | "guest" | "authed";
/** Phase 3 · 历史统计（全量口径，GET /api/exploration/history 返回） */
type HistoryStats = {
  total: number;
  rareCount: number;
  totalSteps: number;
  totalDistance: number;
};
/** Phase 3 · 历史筛选（type=事件类型 / rare=只看稀有） */
type HistoryFilter = { type?: string; rare?: boolean };

/** 历史筛选 chips 定义（key 对应 i18n explorationV2.history.filters.<key>） */
const HISTORY_FILTERS: ReadonlyArray<{ key: string; type?: string; rare?: boolean }> = [
  { key: "all" },
  { key: "postcard", type: "postcard" },
  { key: "gift", type: "gift" },
  { key: "knowledge", type: "knowledge" },
  { key: "encounter", type: "encounter" },
  { key: "rest", type: "rest" },
  { key: "rare", rare: true },
];

/** 每次请求动态读取 localStorage 中的登录 token（与 chat-panel 的 transport 同款模式）。 */
function bearerHeaders(): HeadersInit {
  const token = localStorage.getItem("aiabw_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function ExploreV2Panel({ className = "" }: { className?: string }) {
  const t = useTranslations("explorationV2");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [quota, setQuota] = useState<Quota | null>(null);
  const [quotaFailed, setQuotaFailed] = useState(false);
  const [records, setRecords] = useState<TimelineRecord[]>([]);
  const [result, setResult] = useState<ExploreResultModalData | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeCardData | null>(null);
  // Phase 3：连续探索天数（连探进度条）/ 历史统计 / 历史筛选
  const [streak, setStreak] = useState(0);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>({});
  // 成就面板刷新信号：每次探索完成 +1 → AchievementPanel 重新拉取进度
  const [achvRefreshKey, setAchvRefreshKey] = useState(0);

  const onAuthExpired = useCallback(() => {
    localStorage.removeItem("aiabw_token");
    setAuthState("guest");
  }, []);

  const bootstrap = useCallback(async () => {
    if (!localStorage.getItem("aiabw_token")) {
      setAuthState("guest");
      return;
    }
    setQuotaFailed(false);
    try {
      const [qRes, hRes] = await Promise.all([
        fetch("/api/exploration/quota", {
          headers: bearerHeaders(),
          cache: "no-store",
        }),
        fetch("/api/exploration/history?limit=50", {
          headers: bearerHeaders(),
          cache: "no-store",
        }),
      ]);
      if (qRes.status === 401 || hRes.status === 401) {
        // token 失效（过期 / 已登出）→ 清理后进入游客态
        onAuthExpired();
        return;
      }
      const q = (await qRes.json().catch(() => null)) as
        | { ok: true; todayCount: number; maxCount: number; isVip: boolean; streak?: number }
        | { ok: false }
        | null;
      if (q && "ok" in q && q.ok) {
        setQuota({
          todayCount: q.todayCount,
          maxCount: q.maxCount,
          isVip: q.isVip,
          streak: q.streak ?? 0,
        });
        setStreak(q.streak ?? 0);
      } else {
        setQuotaFailed(true);
      }
      const h = (await hRes.json().catch(() => null)) as
        | { ok: true; records: TimelineRecord[]; stats?: HistoryStats }
        | { ok: false }
        | null;
      if (h && "ok" in h && h.ok && Array.isArray(h.records)) {
        setRecords(h.records);
        if (h.stats) setStats(h.stats);
      }
      setAuthState("authed");
    } catch (err) {
      console.error("[ExploreV2Panel] bootstrap failed:", err);
      setQuotaFailed(true);
      setAuthState("authed");
    }
  }, [onAuthExpired]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Phase 3：加载历史（带筛选参数 + 全量统计）
  const loadHistory = useCallback(
    async (filter: HistoryFilter = {}) => {
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (filter.type) params.set("type", filter.type);
        if (filter.rare) params.set("rare", "1");
        const res = await fetch(`/api/exploration/history?${params.toString()}`, {
          headers: bearerHeaders(),
          cache: "no-store",
        });
        if (res.status === 401) {
          onAuthExpired();
          return;
        }
        const data = (await res.json().catch(() => null)) as
          | { ok: true; records: TimelineRecord[]; stats?: HistoryStats }
          | { ok: false }
          | null;
        if (data && "ok" in data && data.ok && Array.isArray(data.records)) {
          setRecords(data.records);
          if (data.stats) setStats(data.stats);
        }
      } catch (err) {
        console.error("[ExploreV2Panel] loadHistory failed:", err);
      }
    },
    [onAuthExpired],
  );

  // 切换历史筛选：更新状态并按新条件重拉
  const applyHistoryFilter = useCallback(
    (f: HistoryFilter) => {
      setHistoryFilter(f);
      void loadHistory(f);
    },
    [loadHistory],
  );

  const loadKnowledge = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/animal-wiki/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; knowledge: KnowledgeCardData }
        | { ok: false }
        | null;
      if (data && "ok" in data && data.ok) {
        setKnowledge(data.knowledge);
      }
    } catch (err) {
      console.error("[ExploreV2Panel] loadKnowledge failed:", err);
    }
  }, []);

  const onResult = useCallback(
    (payload: ExploreResultPayload) => {
      const newRecord: TimelineRecord = {
        id: payload.eventId + "-" + Date.now(),
        resultType: payload.eventType,
        title: payload.title,
        description: payload.description,
        emoji: payload.emoji,
        rarity: payload.rarity,
        isRare: payload.isRare,
        stepsGained: payload.steps,
        distanceGained: payload.distance,
        knowledgeId: payload.knowledge?.id ?? null,
        createdAt: new Date().toISOString(),
      };
      setRecords((prev) => [newRecord, ...prev]);
      setAchvRefreshKey((k) => k + 1);
      setResult({
        emoji: payload.emoji,
        title: payload.title,
        description: payload.description,
        rarity: payload.rarity,
        isRare: payload.isRare,
        steps: payload.steps,
        distance: payload.distance,
        knowledge: payload.knowledge
          ? {
              id: payload.knowledge.id,
              species: payload.knowledge.species,
              category: payload.knowledge.category,
            }
          : null,
        newlyUnlocked: payload.newlyUnlocked ?? null,
        rewards: payload.rewards ?? null,
      });
      // Phase 3：探索完成后连探天数即时刷新（进度条联动）
      if (payload.rewards?.streak) setStreak(payload.rewards.streak);
    },
    [],
  );

  // 游客态：仅确认无 token / token 失效时才展示「请先登录」+ 登录入口
  if (authState === "guest") {
    return (
      <div
        className={`flex flex-col items-center gap-3 py-12 ${className}`}
        data-testid="explore-v2-panel"
      >
        <p className="text-sm text-zinc-500">{t("signInFirst")}</p>
        <Link
          href={`/${locale}/login?redirect=/${locale}/explore-v2`}
          className="rounded-lg bg-gradient-to-r from-orange-500 to-pink-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-orange-600 hover:to-pink-600"
          data-testid="explore-signin-link"
        >
          {tc("signIn")}
        </Link>
      </div>
    );
  }

  if (authState === "loading") {
    return (
      <div
        className={`py-12 text-center text-sm text-zinc-400 ${className}`}
        data-testid="explore-v2-panel"
      >
        {tc("loading")}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-4 ${className}`} data-testid="explore-v2-panel">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-bold text-zinc-900">
          🌿 {t("panelTitle")}
        </h2>
      </header>

      <AchievementPanel refreshKey={achvRefreshKey} />

      {quota ? (
        <ExploreButton
          initialTodayCount={quota.todayCount}
          initialMaxCount={quota.maxCount}
          initialIsVip={quota.isVip}
          onResult={onResult}
          onLimit={() => {
            // free user exhausted → highlight upgrade button visually
          }}
          onAuthExpired={onAuthExpired}
        />
      ) : quotaFailed ? (
        <button
          type="button"
          onClick={() => void bootstrap()}
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 transition hover:bg-rose-100"
          data-testid="reload-quota"
        >
          {t("loadFailedRetry")}
        </button>
      ) : null}

      {/* Phase 3 · 连续探索进度条（7 天一轮视觉目标；加成 min(streak-1, 5) 与后端同口径） */}
      <div
        className="rounded-xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 px-3 py-2"
        data-testid="explore-streak-bar"
      >
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-orange-800">
            🔥 {t("streak.label")} · {t("streak.days", { n: streak })}
          </span>
          {streak > 1 ? (
            <span className="text-orange-600" data-testid="explore-streak-bonus">
              {t("streak.bonus", {
                n: Math.min(streak - 1, EXPLORATION_REWARD_CONFIG.STREAK_BONUS_CAP),
              })}
            </span>
          ) : (
            <span className="text-[10px] text-orange-500">{t("streak.nextHint")}</span>
          )}
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-orange-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-orange-400 to-amber-500 transition-all duration-500"
            style={{ width: `${(Math.min(streak, 7) / 7) * 100}%` }}
            data-testid="explore-streak-progress"
          />
        </div>
      </div>

      {/* P1 故事外显：明信片墙（探索产出外显 + 系列集齐图鉴奖励） */}
      <PostcardWall refreshKey={achvRefreshKey} />

      <section>
        <h3 className="mb-2 text-sm font-semibold text-zinc-700">
          🐾 {t("timelineTitle")}
        </h3>
        {/* Phase 3 · 全量统计条 + 筛选 chips */}
        {stats && stats.total > 0 && (
          <p className="mb-2 text-[11px] text-zinc-500" data-testid="explore-history-stats">
            {t("history.statsLine", {
              total: stats.total,
              steps: stats.totalSteps,
              distance: stats.totalDistance,
              rare: stats.rareCount,
            })}
          </p>
        )}
        <div className="mb-2 flex flex-wrap gap-1.5" data-testid="explore-history-filters">
          {HISTORY_FILTERS.map((f) => {
            const active =
              (historyFilter.type ?? "") === (f.type ?? "") &&
              !!historyFilter.rare === !!f.rare;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => applyHistoryFilter(f)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                  active
                    ? "bg-orange-500 text-white shadow-sm"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
                data-testid={`explore-filter-${f.key}`}
                aria-pressed={active}
              >
                {t(`history.filters.${f.key}`)}
              </button>
            );
          })}
        </div>
        <PetTimeline
          records={records}
          onViewKnowledge={(id) => void loadKnowledge(id)}
        />
        <button
          type="button"
          onClick={() => void loadHistory(historyFilter)}
          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-50"
          data-testid="refresh-history"
        >
          {t("refreshHistory")}
        </button>
      </section>

      <ExploreResultModal
        result={result}
        onClose={() => setResult(null)}
        onViewKnowledge={(id) => void loadKnowledge(id)}
      />
      <KnowledgeCard knowledge={knowledge} onClose={() => setKnowledge(null)} />
    </div>
  );
}

export default ExploreV2Panel;
