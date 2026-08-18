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
  adoptedAt: string | null;
  memory: {
    facts: { text: string; ts: number; category?: "user" | "pet"; pinned?: boolean }[];
    usedChars: number;
  };
};

type SortKey = "recent" | "happiness" | "level" | "points";

export default function MyPetsPage() {
  const router = useRouter();
  const [pets, setPets] = useState<PetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [selectedPet, setSelectedPet] = useState<PetItem | null>(null);

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
      else setError(data?.error ?? "Failed to load");
    } catch {
      setError("Network error, please try again");
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
      const facts = data.facts;
      setPets((prev) =>
        prev.map((p) => (p.id === pet.id ? { ...p, memory: { ...p.memory, facts } } : p)),
      );
      setSelectedPet((prev) =>
        prev && prev.id === pet.id ? { ...prev, memory: { ...prev.memory, facts } } : prev,
      );
    }
  };

  const deleteFact = async (pet: PetItem, text: string) => {
    const data = await callMemory(pet.id, "delete", text);
    if (data?.ok) {
      const facts = data.facts;
      setPets((prev) =>
        prev.map((p) => (p.id === pet.id ? { ...p, memory: { ...p.memory, facts } } : p)),
      );
      setSelectedPet((prev) =>
        prev && prev.id === pet.id ? { ...prev, memory: { ...prev.memory, facts } } : prev,
      );
    }
  };

  const q = search.trim().toLowerCase();

  const groupsFor = (pet: PetItem) =>
    [
      {
        key: "user",
        title: "👤 About the user",
        list: pet.memory.facts.filter((f) => (f.category ?? "user") === "user"),
      },
      {
        key: "pet",
        title: "🐾 About the pet",
        list: pet.memory.facts.filter((f) => f.category === "pet"),
      },
    ].filter((g) => g.list.length > 0);

  const sortedPets = [...pets].sort((a, b) => {
    switch (sortBy) {
      case "happiness":
        return b.happiness - a.happiness;
      case "level":
        return b.level - a.level;
      case "points":
        return b.monthlyPoints - a.monthlyPoints;
      default:
        return (b.adoptedAt ?? "").localeCompare(a.adoptedAt ?? "");
    }
  });

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">My pets</h1>
            <p className="text-xs text-zinc-500">
              All the memories you&apos;ve built with your companions live here.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:border-violet-400 focus:outline-none"
              title="Sort by"
            >
              <option value="recent">Recently adopted</option>
              <option value="happiness">Highest mood</option>
              <option value="level">Highest level</option>
              <option value="points">Most points</option>
            </select>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Search memories…"
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:border-violet-400 focus:outline-none"
            />
            <Link
              href="/"
              className="rounded-full bg-orange-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-orange-600"
            >
              🐾 Adopt more
            </Link>
          </div>
        </div>

        {loading && <p className="py-10 text-center text-sm text-zinc-400">Loading…</p>}
        {error && <p className="py-10 text-center text-sm text-red-600">{error}</p>}
        {!loading && !error && pets.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-zinc-500">No companions yet - go adopt one!</p>
            <Link
              href="/"
              className="mt-4 inline-block rounded-full bg-orange-500 px-6 py-2 text-sm font-medium text-white hover:bg-orange-600"
            >
              Adopt a pet
            </Link>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {sortedPets.map((pet) => {
            const mo = moodInfo(pet.happiness);
            const facts = pet.memory.facts
              .filter((f) => (q ? f.text.toLowerCase().includes(q) : true))
              .sort(
                (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.ts - a.ts,
              );
            const groups = [
              {
                key: "user",
                title: "👤 About the user",
                list: facts.filter((f) => (f.category ?? "user") === "user"),
              },
              {
                key: "pet",
                title: "🐾 About the pet",
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
                          Unlocked
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {mo.emoji} {mo.label} · Points {pet.monthlyPoints} · Chats {pet.chatCount}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPet(pet)}
                    className="shrink-0 rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 transition hover:bg-zinc-50"
                  >
                    Details
                  </button>
                  {pet.threadId && (
                    <button
                      type="button"
                      onClick={() => router.push(`/chat?thread=${pet.threadId}&adopt=${pet.id}`)}
                      className="shrink-0 rounded-full bg-violet-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-600"
                    >
                      Chat
                    </button>
                  )}
                </div>

                <div className="mt-3 border-t border-zinc-100 pt-2">
                  {groups.length === 0 ? (
                    <p className="py-2 text-xs text-zinc-400">No memories yet.</p>
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
                                title={f.pinned ? "Unpin" : "Pin"}
                              >
                                📌
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteFact(pet, f.text)}
                                className="text-[10px] text-zinc-300 hover:text-red-500"
                                title="Delete"
                              >
                                Delete
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

      {selectedPet && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-900/50 p-4 backdrop-blur-sm"
          onClick={() => setSelectedPet(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedPet.avatar}
                alt={selectedPet.petName}
                className="h-14 w-14 rounded-full border border-orange-200 bg-orange-50 object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-zinc-900">
                    {selectedPet.petName}
                  </span>
                  <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                    Lv.{selectedPet.level}
                  </span>
                  {selectedPet.isUnlocked && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                      Unlocked
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500">
                  {moodInfo(selectedPet.happiness).emoji}{" "}
                  {moodInfo(selectedPet.happiness).label} · Adopted on{" "}
                  {selectedPet.adoptedAt
                    ? new Date(selectedPet.adoptedAt).toLocaleDateString()
                    : "—"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPet(null)}
                className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* 统计 */}
            <div className="mt-4 space-y-2">
              <div>
                <div className="mb-1 flex justify-between text-xs text-zinc-500">
                  <span>Mood</span>
                  <span>{selectedPet.happiness}/100</span>
                </div>
                <div className="h-2 rounded-full bg-zinc-100">
                  <div
                    className="h-2 rounded-full bg-orange-400"
                    style={{ width: `${selectedPet.happiness}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-zinc-50 py-2">
                  <div className="text-sm font-semibold text-zinc-800">
                    Lv.{selectedPet.level}
                  </div>
                  <div className="text-[10px] text-zinc-400">Level</div>
                </div>
                <div className="rounded-xl bg-zinc-50 py-2">
                  <div className="text-sm font-semibold text-zinc-800">
                    {selectedPet.monthlyPoints}
                  </div>
                  <div className="text-[10px] text-zinc-400">Monthly points</div>
                </div>
                <div className="rounded-xl bg-zinc-50 py-2">
                  <div className="text-sm font-semibold text-zinc-800">
                    {selectedPet.chatCount}
                  </div>
                  <div className="text-[10px] text-zinc-400">Chats</div>
                </div>
              </div>
            </div>

            {/* 记忆 */}
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
              {groupsFor(selectedPet).length === 0 ? (
                <p className="py-4 text-center text-sm text-zinc-400">
                  No memories yet.
                </p>
              ) : (
                groupsFor(selectedPet).map((g) => (
                  <div key={g.key} className="mb-2">
                    <div className="text-xs font-medium text-zinc-500">
                      {g.title}
                    </div>
                    {g.list.map((f) => (
                      <div
                        key={f.text}
                        className="flex items-start justify-between gap-2 py-0.5"
                      >
                        <span className="text-sm text-zinc-700">
                          {f.pinned && (
                            <span className="mr-1 text-amber-500">📌</span>
                          )}
                          {f.text}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => togglePin(selectedPet, f)}
                            className={`text-[10px] ${
                              f.pinned
                                ? "text-amber-500"
                                : "text-zinc-300 hover:text-amber-500"
                            }`}
                          >
                            📌
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteFact(selectedPet, f.text)}
                            className="text-[10px] text-zinc-300 hover:text-red-500"
                          >
                            Delete
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>

            {selectedPet.threadId && (
              <button
                type="button"
                onClick={() =>
                  router.push(
                    `/chat?thread=${selectedPet.threadId}&adopt=${selectedPet.id}`,
                  )
                }
                className="mt-4 w-full rounded-full bg-violet-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-600"
              >
                Chat
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

