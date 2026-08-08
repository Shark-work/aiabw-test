"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { moodInfo } from "@/components/chat/chat-client";
import { getAnonymousId } from "@/lib/anon-id";

type PetItem = {
  id: string;
  petType: string;
  petName: string;
  avatar: string;
  level: number;
  happiness: number;
  chatCount: number;
  monthlyPoints: number;
  isUnlocked: boolean;
  threadId: string | null;
  memory: {
    facts: { text: string; ts: number; category?: "user" | "pet"; pinned?: boolean }[];
    usedChars: number;
  };
};

export default function MyPetsPage() {
  const router = useRouter();
  const [pets, setPets] = useState<PetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const loadPets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = localStorage.getItem("aiabw_token");
      const anonymousId = getAnonymousId();
      const res = await fetch(
        `/api/pets?anonymousId=${encodeURIComponent(anonymousId)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      const data = await res.json();
      if (data?.ok) setPets(data.pets ?? []);
      else setError(data?.error ?? "加载失败");
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPets();
  }, [loadPets]);

  const callMemory = useCallback(
    async (adoptionId: string, action: string, text?: string) => {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptionId, action, text }),
      });
      const data = await res.json();
      return data;
    },
    [],
  );

  const togglePin = async (pet: PetItem, fact: { text: string; pinned?: boolean }) => {
    const data = await callMemory(pet.id, fact.pinned ? "unpin" : "pin", fact.text);
    if (data?.ok) {
      setPets((prev) =>
        prev.map((p) =>
          p.id === pet.id
            ? { ...p, memory: { ...p.memory, facts: data.facts } }
            : p,
        ),
      );
    }
  };

  const deleteFact = async (pet: PetItem, text: string) => {
    const data = await callMemory(pet.id, "delete", text);
    if (data?.ok) {
      setPets((prev) =>
        prev.map((p) =>
          p.id === pet.id
            ? { ...p, memory: { ...p.memory, facts: data.facts } }
            : p,
        ),
      );
    }
  };

  const q = search.trim().toLowerCase();

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">我的宠物</h1>
            <p className="text-xs text-zinc-500">
              这里保存着你和伙伴们一起积累的记忆~
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 搜索记忆…"
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:border-violet-400 focus:outline-none"
            />
            <Link
              href="/"
              className="rounded-full bg-orange-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-orange-600"
            >
              🐾 领养更多
            </Link>
          </div>
        </div>

        {loading && <p className="py-10 text-center text-sm text-zinc-400">加载中…</p>}
        {error && <p className="py-10 text-center text-sm text-red-600">{error}</p>}
        {!loading && !error && pets.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-zinc-500">还没有宠物伙伴，快去领养一只吧~</p>
            <Link
              href="/"
              className="mt-4 inline-block rounded-full bg-orange-500 px-6 py-2 text-sm font-medium text-white hover:bg-orange-600"
            >
              去领养
            </Link>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {pets.map((pet) => {
            const mo = moodInfo(pet.happiness);
            const facts = pet.memory.facts
              .filter((f) => (q ? f.text.toLowerCase().includes(q) : true))
              .sort(
                (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.ts - a.ts,
              );
            const groups = [
              {
                key: "user",
                title: "👤 关于用户",
                list: facts.filter((f) => (f.category ?? "user") === "user"),
              },
              {
                key: "pet",
                title: "🐾 关于宠物",
                list: facts.filter((f) => f.category === "pet"),
              },
            ].filter((g) => g.list.length > 0);

            return (
              <div
                key={pet.id}
                className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm backdrop-blur"
              >
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={pet.avatar}
                    alt={pet.petName}
                    className="h-14 w-14 rounded-full border border-orange-200 bg-orange-50 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-900">
                        {pet.petName}
                      </span>
                      <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                        Lv.{pet.level}
                      </span>
                      {pet.isUnlocked && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          已解锁
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {mo.emoji} {mo.label} · 积分 {pet.monthlyPoints} · 对话 {pet.chatCount} 句
                    </div>
                  </div>
                  {pet.threadId && (
                    <button
                      type="button"
                      onClick={() => router.push(`/chat?thread=${pet.threadId}&adopt=${pet.id}`)}
                      className="shrink-0 rounded-full bg-violet-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-600"
                    >
                      去聊天
                    </button>
                  )}
                </div>

                <div className="mt-3 border-t border-zinc-100 pt-2">
                  {groups.length === 0 ? (
                    <p className="py-2 text-xs text-zinc-400">还没有记忆~</p>
                  ) : (
                    groups.map((g) => (
                      <div key={g.key} className="mb-1.5">
                        <div className="text-[11px] font-medium text-zinc-400">
                          {g.title}
                        </div>
                        {g.list.map((f) => (
                          <div
                            key={f.text}
                            className="flex items-start justify-between gap-2 py-0.5"
                          >
                            <span className="text-xs text-zinc-600">
                              {f.pinned && (
                                <span className="mr-1 text-amber-500">📌</span>
                              )}
                              {f.text}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <button
                                type="button"
                                onClick={() => togglePin(pet, f)}
                                className={`text-[10px] ${
                                  f.pinned
                                    ? "text-amber-500"
                                    : "text-zinc-300 hover:text-amber-500"
                                }`}
                                title={f.pinned ? "取消置顶" : "置顶"}
                              >
                                📌
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteFact(pet, f.text)}
                                className="text-[10px] text-zinc-300 hover:text-red-500"
                                title="删除"
                              >
                                删除
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}

