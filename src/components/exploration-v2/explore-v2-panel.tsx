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

type Quota = { todayCount: number; maxCount: number; isVip: boolean };
type AuthState = "loading" | "guest" | "authed";

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
        | { ok: true; todayCount: number; maxCount: number; isVip: boolean }
        | { ok: false }
        | null;
      if (q && "ok" in q && q.ok) {
        setQuota({ todayCount: q.todayCount, maxCount: q.maxCount, isVip: q.isVip });
      } else {
        setQuotaFailed(true);
      }
      const h = (await hRes.json().catch(() => null)) as
        | { ok: true; records: TimelineRecord[] }
        | { ok: false }
        | null;
      if (h && "ok" in h && h.ok && Array.isArray(h.records)) {
        setRecords(h.records);
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

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/exploration/history?limit=50", {
        headers: bearerHeaders(),
        cache: "no-store",
      });
      if (res.status === 401) {
        onAuthExpired();
        return;
      }
      const data = (await res.json().catch(() => null)) as
        | { ok: true; records: TimelineRecord[] }
        | { ok: false }
        | null;
      if (data && "ok" in data && data.ok && Array.isArray(data.records)) {
        setRecords(data.records);
      }
    } catch (err) {
      console.error("[ExploreV2Panel] loadHistory failed:", err);
    }
  }, [onAuthExpired]);

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
      });
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

      <section>
        <h3 className="mb-2 text-sm font-semibold text-zinc-700">
          🐾 {t("timelineTitle")}
        </h3>
        <PetTimeline
          records={records}
          onViewKnowledge={(id) => void loadKnowledge(id)}
        />
        <button
          type="button"
          onClick={() => void loadHistory()}
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
