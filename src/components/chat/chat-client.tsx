"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
  const [isGuest, setIsGuest] = useState(false);
  const [loginRedirect, setLoginRedirect] = useState("/chat");
  const [showMigratedToast, setShowMigratedToast] = useState(false);

  // —— 记忆可视化 / 管理 ——
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryFacts, setMemoryFacts] = useState<{ text: string; ts: number }[]>([]);
  const [memoryUsedChars, setMemoryUsedChars] = useState(0);
  const [memoryMaxChars, setMemoryMaxChars] = useState(3000);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState("");

  const openMemory = useCallback(async () => {
    setMemoryOpen(true);
    setMemoryError("");
    if (!adoptionIdState) return;
    setMemoryLoading(true);
    try {
      const res = await fetch(`/api/memory?adoptionId=${adoptionIdState}`);
      const data = await res.json();
      if (data?.ok) {
        setMemoryFacts(data.facts ?? []);
        setMemoryUsedChars(data.usedChars ?? 0);
        setMemoryMaxChars(data.maxChars ?? 3000);
      } else {
        setMemoryError(data?.error ?? "读取记忆失败");
      }
    } catch {
      setMemoryError("读取记忆失败，请稍后重试");
    } finally {
      setMemoryLoading(false);
    }
  }, [adoptionIdState]);

  const deleteMemoryFact = useCallback(
    async (text: string) => {
      if (!adoptionIdState) return;
      try {
        const res = await fetch("/api/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adoptionId: adoptionIdState, action: "delete", text }),
        });
        const data = await res.json();
        if (data?.ok) {
          setMemoryFacts(data.facts ?? []);
          setMemoryUsedChars(data.usedChars ?? 0);
        }
      } catch {
        // 忽略
      }
    },
    [adoptionIdState],
  );

  const clearMemory = useCallback(async () => {
    if (!adoptionIdState) return;
    if (!confirm("确定要清空宠物的全部记忆吗？此操作不可恢复。")) return;
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptionId: adoptionIdState, action: "clear" }),
      });
      const data = await res.json();
      if (data?.ok) {
        setMemoryFacts([]);
        setMemoryUsedChars(0);
      }
    } catch {
      // 忽略
    }
  }, [adoptionIdState]);

  // 游客检测：没有登录 token 时提示引导登录
  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    setIsGuest(!token);
    setLoginRedirect(window.location.pathname + window.location.search);

    // 登录/注册后迁移了游客数据 → 显示找回提示
    if (sessionStorage.getItem("aiabw_migrated_toast") === "1") {
      sessionStorage.removeItem("aiabw_migrated_toast");
      setShowMigratedToast(true);
      const t = setTimeout(() => setShowMigratedToast(false), 4000);
      return () => clearTimeout(t);
    }
  }, []);

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
    <div className="flex h-full flex-col gap-2">
      {showMigratedToast && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-sm text-emerald-700 shadow-sm">
          🎉 已为你找回之前的聊天记录和宠物记忆 ✨
        </div>
      )}
      {isGuest && (
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm">
          <span className="text-amber-800">
            🔒 你是游客模式，刷新后宠物记忆会丢失。
          </span>
          <Link
            href={`/login?redirect=${encodeURIComponent(loginRedirect)}`}
            className="font-medium text-orange-600 hover:underline"
          >
            登录以保存你的宠物记忆
          </Link>
        </div>
      )}

      {adoptionIdState && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={openMemory}
            className="rounded-full border border-violet-200 bg-white/80 px-3 py-1 text-xs font-medium text-violet-600 shadow-sm backdrop-blur transition hover:bg-violet-50"
          >
            🧠 记忆
          </button>
        </div>
      )}

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

      {/* 记忆可视化 / 管理弹窗 */}
      {memoryOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-900/50 p-4 backdrop-blur-sm"
          onClick={() => setMemoryOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-zinc-900">🧠 {pet.name}的长期记忆</h3>
              <button
                type="button"
                onClick={() => setMemoryOpen(false)}
                className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            <div className="mt-1 text-xs text-zinc-500">
              已用 {memoryUsedChars} / {memoryMaxChars} 字符
              <span className="ml-2 text-violet-500">
                {Math.min(100, Math.round((memoryUsedChars / memoryMaxChars) * 100))}%
              </span>
            </div>

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              {memoryLoading && <p className="text-sm text-zinc-400">加载中…</p>}
              {memoryError && <p className="text-sm text-red-600">{memoryError}</p>}
              {!memoryLoading && !memoryError && memoryFacts.length === 0 && (
                <p className="py-6 text-center text-sm text-zinc-400">
                  还没有记忆，多和{pet.name}聊聊，它会记住你~
                </p>
              )}
              {!memoryLoading &&
                memoryFacts.map((f) => (
                  <div
                    key={f.text}
                    className="mb-2 flex items-start justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2"
                  >
                    <span className="text-sm text-zinc-700">{f.text}</span>
                    <button
                      type="button"
                      onClick={() => deleteMemoryFact(f.text)}
                      className="shrink-0 text-xs text-zinc-400 hover:text-red-500"
                      title="删除这条记忆"
                    >
                      删除
                    </button>
                  </div>
                ))}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={clearMemory}
                disabled={memoryFacts.length === 0}
                className="flex-1 rounded-full border border-red-200 px-3 py-2 text-sm text-red-500 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                清空全部记忆
              </button>
              <button
                type="button"
                onClick={() => setMemoryOpen(false)}
                className="flex-1 rounded-full bg-zinc-100 px-3 py-2 text-sm text-zinc-600 transition hover:bg-zinc-200"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    );
}
