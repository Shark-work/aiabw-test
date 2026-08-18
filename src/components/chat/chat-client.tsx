"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { UIMessage } from "ai";

import { ChatPanel } from "@/components/chat/chat-panel";
import type { PetConfig } from "@/lib/pet-config";

/** 根据心情值返回对应的表情与文案。 */
export function moodInfo(happiness: number) {
  if (happiness < 30) return { emoji: "😢", label: "Sad" };
  if (happiness < 50) return { emoji: "😐", label: "OK" };
  if (happiness < 80) return { emoji: "😊", label: "Happy" };
  return { emoji: "🥰", label: "Ecstatic" };
}

/** 记忆分类切换：用户 / 宠物 */
function CategoryToggle({
  value,
  onChange,
}: {
  value: "user" | "pet";
  onChange: (v: "user" | "pet") => void;
}) {
  const base =
    "px-3 py-1 transition";
  return (
    <div className="flex shrink-0 overflow-hidden rounded-full border border-zinc-200 text-xs">
      <button
        type="button"
        onClick={() => onChange("user")}
        className={`${base} ${
          value === "user" ? "bg-violet-100 font-medium text-violet-700" : "bg-white text-zinc-500 hover:bg-zinc-50"
        }`}
      >
        👤 User
      </button>
      <button
        type="button"
        onClick={() => onChange("pet")}
        className={`${base} ${
          value === "pet" ? "bg-orange-100 font-medium text-orange-700" : "bg-white text-zinc-500 hover:bg-zinc-50"
        }`}
      >
        🐾 Pet
      </button>
    </div>
  );
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
  type MemoryFactView = {
    text: string;
    ts: number;
    category?: "user" | "pet";
    pinned?: boolean;
  };
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryFacts, setMemoryFacts] = useState<MemoryFactView[]>([]);
  const [memoryUsedChars, setMemoryUsedChars] = useState(0);
  const [memoryMaxChars, setMemoryMaxChars] = useState(3000);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState("");
  // 新增记忆
  const [newFactText, setNewFactText] = useState("");
  const [newFactCategory, setNewFactCategory] = useState<"user" | "pet">("user");
  // 编辑记忆
  const [editingOldText, setEditingOldText] = useState<string | null>(null);
  const [editFactText, setEditFactText] = useState("");
  const [editFactCategory, setEditFactCategory] = useState<"user" | "pet">("user");
  // 搜索
  const [memorySearch, setMemorySearch] = useState("");

  const applyFacts = (facts: MemoryFactView[]) => {
    setMemoryFacts(facts);
    setMemoryUsedChars(facts.reduce((s, f) => s + f.text.length, 0));
  };

  const openMemory = useCallback(async () => {
    setMemoryOpen(true);
    setMemoryError("");
    if (!adoptionIdState) return;
    setMemoryLoading(true);
    try {
      const res = await fetch(`/api/memory?adoptionId=${adoptionIdState}`);
      const data = await res.json();
      if (data?.ok) {
        applyFacts(data.facts ?? []);
        setMemoryMaxChars(data.maxChars ?? 3000);
      } else {
        setMemoryError(data?.error ?? "Failed to load memories");
      }
    } catch {
      setMemoryError("Failed to load memories, please try again");
    } finally {
      setMemoryLoading(false);
    }
  }, [adoptionIdState]);

  const addMemoryFact = useCallback(async () => {
    const text = newFactText.trim();
    if (!text || !adoptionIdState) return;
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adoptionId: adoptionIdState,
          action: "add",
          text,
          category: newFactCategory,
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        applyFacts(data.facts ?? []);
        setNewFactText("");
      }
    } catch {
      // 忽略
    }
  }, [adoptionIdState, newFactText, newFactCategory]);

  const startEditFact = (f: MemoryFactView) => {
    setEditingOldText(f.text);
    setEditFactText(f.text);
    setEditFactCategory(f.category ?? "user");
  };

  const saveEditFact = useCallback(async () => {
    const text = editFactText.trim();
    if (!text || !adoptionIdState || !editingOldText) return;
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adoptionId: adoptionIdState,
          action: "update",
          oldText: editingOldText,
          text,
          category: editFactCategory,
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        applyFacts(data.facts ?? []);
        setEditingOldText(null);
      }
    } catch {
      // 忽略
    }
  }, [adoptionIdState, editingOldText, editFactText, editFactCategory]);

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
          applyFacts(data.facts ?? []);
          if (editingOldText === text) setEditingOldText(null);
        }
      } catch {
        // 忽略
      }
    },
    [adoptionIdState, editingOldText],
  );

  const togglePinFact = useCallback(
    async (text: string, pinned: boolean) => {
      if (!adoptionIdState) return;
      try {
        const res = await fetch("/api/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adoptionId: adoptionIdState,
            action: pinned ? "pin" : "unpin",
            text,
          }),
        });
        const data = await res.json();
        if (data?.ok) applyFacts(data.facts ?? []);
      } catch {
        // 忽略
      }
    },
    [adoptionIdState],
  );

  const clearMemory = useCallback(async () => {
    if (!adoptionIdState) return;
    if (!confirm("Clear all of this pet's memories? This cannot be undone.")) return;
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptionId: adoptionIdState, action: "clear" }),
      });
      const data = await res.json();
      if (data?.ok) {
        applyFacts([]);
        setEditingOldText(null);
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

  // 记忆按分类分组展示（支持搜索；置顶优先、再按时间倒序）
  const memoryQuery = memorySearch.trim().toLowerCase();
  const visibleFacts = memoryFacts.filter((f) =>
    memoryQuery ? f.text.toLowerCase().includes(memoryQuery) : true,
  );
  const memoryGroups = [
    {
      key: "user",
      title: "👤 About the user",
      list: visibleFacts.filter((f) => (f.category ?? "user") === "user"),
    },
    {
      key: "pet",
      title: "🐾 About the pet",
      list: visibleFacts.filter((f) => f.category === "pet"),
    },
  ]
    .map((g) => ({
      ...g,
      list: [...g.list].sort(
        (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.ts - a.ts,
      ),
    }))
    .filter((g) => g.list.length > 0);

  return (
    <div className="flex h-full flex-col gap-2">
      {showMigratedToast && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-sm text-emerald-700 shadow-sm">
          🎉 We restored your previous chats and pet memories ✨
        </div>
      )}
      {isGuest && (
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm">
          <span className="text-amber-800">
            🔒 You are in guest mode - pet memories will be lost after a refresh.
          </span>
          <Link
            href={`/login?redirect=${encodeURIComponent(loginRedirect)}`}
            className="font-medium text-orange-600 hover:underline"
          >
            Sign in to save your pet memories
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
            🧠 Memory
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
            {pet.name}&apos;s mood:
            <span className="text-lg">{mo.emoji}</span>
            <span className="ml-1 text-zinc-500">({mo.label})</span>
          </span>
          <span className="flex items-center gap-3">
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
              Lv.{level}
            </span>
            <span className="text-xs text-violet-600">
              Monthly points: {monthlyPoints}
            </span>
            {refreshing && (
              <span className="text-xs text-zinc-400">Refreshing…</span>
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
              <h3 className="text-lg font-bold text-zinc-900">🧠 {pet.name}&apos;s long-term memory</h3>
              <button
                type="button"
                onClick={() => setMemoryOpen(false)}
                className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="mt-1 text-xs text-zinc-500">
              Used {memoryUsedChars} / {memoryMaxChars} chars
              <span className="ml-2 text-violet-500">
                {Math.min(100, Math.round((memoryUsedChars / memoryMaxChars) * 100))}%
              </span>
            </div>

            {/* 搜索记忆 */}
            <input
              type="text"
              value={memorySearch}
              onChange={(e) => setMemorySearch(e.target.value)}
              placeholder="🔍 Search memories…"
              className="mt-3 w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:border-violet-400 focus:outline-none"
            />

            {/* 手动新增记忆 */}
            <div className="mt-3 flex items-center gap-2">
              <input
                type="text"
                value={newFactText}
                onChange={(e) => setNewFactText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addMemoryFact();
                }}
                placeholder="Add a memory, e.g. the user likes indie folk"
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
              <CategoryToggle value={newFactCategory} onChange={setNewFactCategory} />
              <button
                type="button"
                onClick={addMemoryFact}
                disabled={!newFactText.trim()}
                className="shrink-0 rounded-full bg-violet-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add
              </button>
            </div>

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              {memoryLoading && <p className="text-sm text-zinc-400">Loading…</p>}
              {memoryError && <p className="text-sm text-red-600">{memoryError}</p>}
              {!memoryLoading && !memoryError && memoryFacts.length === 0 && (
                <p className="py-6 text-center text-sm text-zinc-400">
                  No memories yet - chat more with {pet.name}, or add one manually.
                </p>
              )}
              {!memoryLoading &&
                !memoryError &&
                memoryGroups.map((g) => (
                  <div key={g.key} className="mb-3">
                    <div className="mb-1.5 text-xs font-medium text-zinc-500">
                      {g.title}
                    </div>
                    {g.list.map((f) => (
                      <div
                        key={f.text}
                        className="mb-2 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2"
                      >
                        {editingOldText === f.text ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={editFactText}
                              onChange={(e) => setEditFactText(e.target.value)}
                              className="w-full rounded-lg border border-zinc-300 px-2 py-1 text-sm focus:border-violet-400 focus:outline-none"
                            />
                            <div className="flex items-center justify-between gap-2">
                              <CategoryToggle
                                value={editFactCategory}
                                onChange={setEditFactCategory}
                              />
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => setEditingOldText(null)}
                                  className="text-xs text-zinc-400 hover:text-zinc-600"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={saveEditFact}
                                  disabled={!editFactText.trim()}
                                  className="text-xs font-medium text-violet-600 hover:underline disabled:opacity-50"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-sm text-zinc-700">{f.text}</span>
                            <div className="flex shrink-0 items-center gap-2">
                              <button
                                type="button"
                                onClick={() => togglePinFact(f.text, !f.pinned)}
                                className={`text-xs ${
                                  f.pinned
                                    ? "text-amber-500"
                                    : "text-zinc-300 hover:text-amber-500"
                                }`}
                                title={f.pinned ? "Unpin" : "Pin"}
                              >
                                📌
                              </button>
                              <button
                                type="button"
                                onClick={() => startEditFact(f)}
                                className="text-xs text-zinc-400 hover:text-violet-600"
                                title="Edit this memory"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteMemoryFact(f.text)}
                                className="text-xs text-zinc-400 hover:text-red-500"
                                title="Delete this memory"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
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
                Clear all memories
              </button>
              <button
                type="button"
                onClick={() => setMemoryOpen(false)}
                className="flex-1 rounded-full bg-zinc-100 px-3 py-2 text-sm text-zinc-600 transition hover:bg-zinc-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    );
}
