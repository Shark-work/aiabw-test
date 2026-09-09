"use client";

/**
 * 探索 v2 · 宠物动态时间线
 *  - 按时间分组（今天 / 昨天 / 本周 / 更早）
 *  - 每条记录展示：大 emoji + 标题 + 描述 + 步数/距离/稀有徽章
 *  - 知识类事件带「查看知识」按钮（触发 onViewKnowledge 回调）
 *  - SSR 友好：records 为空时显示空态
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, Footprints, MapPin, Clock } from "lucide-react";

export type TimelineRecord = {
  id: string;
  resultType: string;
  title: string;
  description: string;
  emoji: string | null;
  rarity: "common" | "rare" | "epic";
  isRare: boolean;
  stepsGained: number;
  distanceGained: number;
  knowledgeId: string | null;
  createdAt: string | Date;
};

type Props = {
  records: TimelineRecord[];
  onViewKnowledge?: (knowledgeId: string) => void;
  className?: string;
};

type Group = { label: string; items: TimelineRecord[] };

function groupByDate(records: TimelineRecord[], t: (k: string) => string): Group[] {
  const now = new Date();
  const todayKey = now.toDateString();
  const yesterdayMs = now.getTime() - 24 * 60 * 60 * 1000;
  const weekMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const groups: Record<string, TimelineRecord[]> = {
    today: [],
    yesterday: [],
    week: [],
    earlier: [],
  };
  for (const r of records) {
    const d = new Date(r.createdAt);
    if (d.toDateString() === todayKey) groups.today.push(r);
    else if (d.getTime() >= yesterdayMs) groups.yesterday.push(r);
    else if (d.getTime() >= weekMs) groups.week.push(r);
    else groups.earlier.push(r);
  }
  const out: Group[] = [];
  if (groups.today.length) out.push({ label: t("groupToday"), items: groups.today });
  if (groups.yesterday.length) out.push({ label: t("groupYesterday"), items: groups.yesterday });
  if (groups.week.length) out.push({ label: t("groupWeek"), items: groups.week });
  if (groups.earlier.length) out.push({ label: t("groupEarlier"), items: groups.earlier });
  return out;
}

const RARITY_BADGE: Record<"common" | "rare" | "epic", { label: string; bg: string; text: string }> = {
  common: { label: "Common", bg: "bg-zinc-100", text: "text-zinc-600" },
  rare: { label: "Rare", bg: "bg-amber-100", text: "text-amber-800" },
  epic: { label: "Epic", bg: "bg-fuchsia-100", text: "text-fuchsia-800" },
};

export function PetTimeline({ records, onViewKnowledge, className = "" }: Props) {
  const t = useTranslations("explorationV2");
  const groups = useMemo(() => groupByDate(records, t), [records, t]);

  if (records.length === 0) {
    return (
      <div
        className={`rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-xs text-zinc-500 ${className}`}
        data-testid="pet-timeline-empty"
      >
        <Clock className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
        {t("timelineEmpty")}
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`} data-testid="pet-timeline">
      {groups.map((g) => (
        <section key={g.label}>
          <h3 className="mb-2 px-1 text-xs font-semibold text-zinc-500">
            {g.label}
          </h3>
          <ol className="space-y-2">
            {g.items.map((r) => {
              const badge = RARITY_BADGE[r.rarity] ?? RARITY_BADGE.common;
              return (
                <li
                  key={r.id}
                  className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3 transition hover:border-amber-200 hover:bg-amber-50/40"
                  data-testid="pet-timeline-item"
                  data-rarity={r.rarity}
                  data-knowledge-id={r.knowledgeId ?? ""}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-50 to-pink-50 text-2xl">
                    {r.emoji ?? "✨"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="truncate text-sm font-semibold text-zinc-900">
                        {r.title || t("untitledEvent")}
                      </h4>
                      {r.isRare && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${badge.bg} ${badge.text}`}
                        >
                          ✨ {badge.label}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-zinc-600">
                      {r.description}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                      <span className="flex items-center gap-0.5">
                        <Footprints className="h-3 w-3" />
                        {r.stepsGained} {t("stepsUnit")}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <MapPin className="h-3 w-3" />
                        {r.distanceGained.toFixed(2)} {t("distanceUnit")}
                      </span>
                      {r.knowledgeId && (
                        <button
                          type="button"
                          onClick={() => onViewKnowledge?.(r.knowledgeId!)}
                          className="ml-auto flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 transition hover:bg-amber-200"
                          data-testid="timeline-view-knowledge"
                        >
                          <BookOpen className="h-3 w-3" />
                          {t("viewKnowledge")}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

export default PetTimeline;
