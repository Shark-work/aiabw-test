"use client";

/**
 * 探索 v2 · 主面板（整合 Timeline + ExploreButton + ResultModal + KnowledgeCard）
 *  - SSR 友好：initialRecords 由父页面（SSR）传入首屏
 *  - 客户端只负责：触发探索 / 加载历史 / 显示结果弹窗 / 显示知识卡
 *  - 任何错误都降级到控制台，不阻塞渲染
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

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

type Props = {
  initialTodayCount: number;
  initialMaxCount: number;
  initialIsVip: boolean;
  initialRecords: TimelineRecord[];
  className?: string;
};

export function ExploreV2Panel({
  initialTodayCount,
  initialMaxCount,
  initialIsVip,
  initialRecords,
  className = "",
}: Props) {
  const t = useTranslations("explorationV2");
  const [records, setRecords] = useState<TimelineRecord[]>(initialRecords);
  const [result, setResult] = useState<ExploreResultModalData | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeCardData | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/exploration/history?limit=50", { cache: "no-store" });
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
  }, []);

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

  return (
    <div className={`flex flex-col gap-4 ${className}`} data-testid="explore-v2-panel">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-bold text-zinc-900">
          🌿 {t("panelTitle")}
        </h2>
      </header>

      <ExploreButton
        initialTodayCount={initialTodayCount}
        initialMaxCount={initialMaxCount}
        initialIsVip={initialIsVip}
        onResult={onResult}
        onLimit={() => {
          // free user exhausted → highlight upgrade button visually
        }}
      />

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
