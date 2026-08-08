"use client";

import { useCallback, useState } from "react";
import type { UIMessage } from "ai";

import { ChatPanel } from "@/components/chat/chat-panel";
import type { PetConfig } from "@/lib/pet-config";

/** 根据心情值返回对应的表情与文案。 */
export function moodInfo(happiness: number) {
  if (happiness < 30) return { emoji: "😢", label: "难过" };
  if (happiness < 50) return { emoji: "😐", label: "一般" };
  if (happiness < 80) return { emoji: "😊", label: "开心" };
  return { emoji: "🥰", label: "超幸福" };
}

export function ChatClient({
  threadId,
  adoptionId,
  initialMessages,
  initialHappiness,
  initialLevel,
  initialMonthlyPoints,
  fallbackWelcome,
  petType,
  pet,
}: {
  threadId?: string;
  adoptionId?: string;
  initialMessages?: UIMessage[];
  initialHappiness: number;
  initialLevel: number;
  initialMonthlyPoints: number;
  fallbackWelcome?: string;
  petType: string;
  pet: PetConfig;
}) {
  const [adoptionIdState] = useState(adoptionId);
  const [happiness, setHappiness] = useState(initialHappiness);
  const [level, setLevel] = useState(initialLevel);
  const [monthlyPoints, setMonthlyPoints] = useState(initialMonthlyPoints);
  const [refreshing, setRefreshing] = useState(false);

  // 每次互动结束后重新拉取最新心情 / 等级 / 月度积分
  const refreshMood = useCallback(async () => {
    if (!adoptionIdState) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/pet/status?id=${adoptionIdState}`);
      const data = await res.json();
      if (data?.ok && typeof data.happiness === "number") {
        setHappiness(data.happiness);
      }
      if (data?.ok && typeof data.level === "number") {
        setLevel(data.level);
      }
      if (data?.ok && typeof data.monthlyPoints === "number") {
        setMonthlyPoints(data.monthlyPoints);
      }
    } catch {
      // 忽略刷新失败
    } finally {
      setRefreshing(false);
    }
  }, [adoptionIdState]);

  const mo = moodInfo(happiness);

  return (
    <ChatPanel
      threadId={threadId}
      adoptionId={adoptionIdState}
      initialMessages={initialMessages}
      welcomeMessage={fallbackWelcome}
      petType={petType}
      pet={pet}
      onInteractionComplete={refreshMood}
      footerInfo={
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2 text-sm">
          <span className="font-medium text-zinc-700">
            {pet.name}现在的心情：
            <span className="text-lg">{mo.emoji}</span>
            <span className="ml-1 text-zinc-500">（{mo.label}）</span>
          </span>
          <span className="flex items-center gap-3">
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
              Lv.{level}
            </span>
            <span className="text-xs text-violet-600">
              本月活跃度积分：{monthlyPoints}
            </span>
            {refreshing && (
              <span className="text-xs text-zinc-400">刷新中…</span>
            )}
          </span>
        </div>
      }
    />
  );
}
