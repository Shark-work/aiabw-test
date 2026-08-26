"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";

import { moodInfo, moodLabel } from "@/components/chat/chat-client";
import { PetAvatar } from "@/components/PetAvatar";
import { CosmeticsShopModal } from "@/components/cosmetics-shop-modal";
import { getAnonymousId } from "@/lib/anon-id";

type PetItem = {
  id: string;
  petType: string;
  petName: string;
  /** 数据层映射后的展示名（官方宠物按 locale 本地化；老数据不修改 DB） */
  displayName?: string;
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
  const t = useTranslations("myPets");
  const tc = useTranslations("common");
  const tchat = useTranslations("chat");
  const locale = useLocale();
  const router = useRouter();
  const [pets, setPets] = useState<PetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [selectedPet, setSelectedPet] = useState<PetItem | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  // 装扮商城（情绪与特权消费）
  const [shopOpen, setShopOpen] = useState(false);

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
      else setError(data?.error ?? tc("loadFailed"));
    } catch {
      setError(tc("networkError"));
    } finally {
      setLoading(false);
    }
  }, [tc]);

  useEffect(() => {
    loadPets();
  }, [loadPets]);

  // 拉取当前用户邀请码（裂变入口：好友通过分享链接注册后邀请人 +50 积分）
  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => {
        if (data?.ok && data.user?.inviteCode) setInviteCode(data.user.inviteCode);
      })
      .catch(() => {
        /* 邀请码拉取失败不影响页面主体 */
      });
  }, []);

  const copyInviteLink = async () => {
    const url = `${window.location.origin}/${locale}/register?ref=${inviteCode}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // 降级：复制仅展示邀请码
      try {
        await navigator.clipboard.writeText(inviteCode);
      } catch {
        return;
      }
    }
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), 2000);
  };

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
        title: t("memoryUser"),
        list: pet.memory.facts.filter((f) => (f.category ?? "user") === "user"),
      },
      {
        key: "pet",
        title: t("memoryPet"),
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
            <h1 className="text-xl font-semibold text-zinc-900">{t("title")}</h1>
            <p className="text-xs text-zinc-500">
              {t("subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:border-violet-400 focus:outline-none"
              title={t("sortBy")}
            >
              <option value="recent">{t("sortRecent")}</option>
              <option value="happiness">{t("sortHappiness")}</option>
              <option value="level">{t("sortLevel")}</option>
              <option value="points">{t("sortPoints")}</option>
            </select>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("search")}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:border-violet-400 focus:outline-none"
            />
            <Link
              href="/"
              className="rounded-full bg-orange-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-orange-600"
            >
              {t("adoptMore")}
            </Link>
          </div>
        </div>

        {/* 进化入口横幅：引导到我的宠物合成页 */}
        <Link
          href="/pets/my"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-100 to-fuchsia-50 p-4 transition hover:border-violet-300 hover:shadow-sm"
        >
          <span className="text-sm font-semibold text-violet-800">{t("evolveBanner")}</span>
          <span className="shrink-0 rounded-full bg-violet-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm">
            {t("evolveGo")}
          </span>
        </Link>

        {inviteCode && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-100 to-amber-50 p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-orange-900">{t("inviteTitle")}</p>
              <p className="mt-0.5 text-xs text-orange-700">{t("inviteHint")}</p>
            </div>
            <button
              type="button"
              onClick={copyInviteLink}
              className="rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-orange-600"
            >
              {inviteCopied ? t("inviteCopied") : t("inviteFriends")}
            </button>
          </div>
        )}

        {loading && <p className="py-10 text-center text-sm text-zinc-400">Loading…</p>}
        {error && <p className="py-10 text-center text-sm text-red-600">{error}</p>}
        {!loading && !error && pets.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-zinc-500">{t("empty")}</p>
            <Link
              href="/"
              className="mt-4 inline-block rounded-full bg-orange-500 px-6 py-2 text-sm font-medium text-white hover:bg-orange-600"
            >
              {t("adopt")}
            </Link>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {sortedPets.map((pet) => {
            const mo = moodInfo(pet.happiness);
            // 禀赋效应：从 adoptions uuid 派生稳定的唯一哈希 ID（#RRGGBB 风格）
            const petIdHash =
              "#" + pet.id.replace(/-/g, "").slice(0, 6).toUpperCase();
            const fmtDate = (d: string | null) => {
              if (!d) return "—";
              const x = new Date(d);
              return `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, "0")}/${String(
                x.getDate(),
              ).padStart(2, "0")}`;
            };
            const facts = pet.memory.facts
              .filter((f) => (q ? f.text.toLowerCase().includes(q) : true))
              .sort(
                (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.ts - a.ts,
              );
            const groups = [
              {
                key: "user",
                title: t("memoryUser"),
                list: facts.filter((f) => (f.category ?? "user") === "user"),
              },
              {
                key: "pet",
                title: t("memoryPet"),
                list: facts.filter((f) => f.category === "pet"),
              },
            ].filter((g) => g.list.length > 0);

            return (
              <div
                key={pet.id}
                className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm backdrop-blur"
              >
                <div className="flex items-center gap-3">
                  <PetAvatar
                    src={pet.avatar}
                    alt={pet.displayName || pet.petName}
                    className="h-14 w-14 rounded-full border border-orange-200 bg-orange-50 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-900">
                        {pet.displayName || pet.petName}
                      </span>
                      <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                        Lv.{pet.level}
                      </span>
                      {pet.isUnlocked && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          {tc("unlocked")}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {t("statsLine", { emoji: mo.emoji, label: moodLabel(tchat, mo.mood), points: pet.monthlyPoints, chats: pet.chatCount })}
                    </div>
                    {/* 禀赋效应：专属印记 + 唯一哈希 ID + 孕育日期 */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-400">
                      <span className="rounded bg-orange-50 px-1 py-0.5 text-[10px] font-semibold text-orange-600">
                        {t("imprintMark")}
                      </span>
                      <span className="font-mono font-semibold text-orange-500">{petIdHash}</span>
                      <span>
                        · {t("imprintDate", { date: fmtDate(pet.adoptedAt) })}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPet(pet)}
                    className="shrink-0 rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 transition hover:bg-zinc-50"
                  >
                    {tc("details")}
                  </button>
                  {pet.threadId && (
                    <button
                      type="button"
                      onClick={() => router.push(`/chat?thread=${pet.threadId}&adopt=${pet.id}`)}
                      className="shrink-0 rounded-full bg-violet-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-600"
                    >
                      {tc("chat")}
                    </button>
                  )}
                </div>

                {/* 损失厌恶：低心情（happiness<40）→ 醒目喂食提示 */}
                {pet.happiness < 40 && (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-orange-50 px-3 py-2">
                    <span className="text-xs font-medium text-orange-700">
                      {t("hungryHint")}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        pet.threadId
                          ? router.push(`/chat?thread=${pet.threadId}&adopt=${pet.id}`)
                          : router.push("/pets")
                      }
                      className="shrink-0 rounded-full bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-600"
                    >
                      {t("feed")}
                    </button>
                  </div>
                )}

                <div className="mt-3 border-t border-zinc-100 pt-2">
                  {groups.length === 0 ? (
                    <p className="py-2 text-xs text-zinc-400">{t("noMemories")}</p>
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
                                title={f.pinned ? t("unpin") : t("pin")}
                              >
                                📌
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteFact(pet, f.text)}
                                className="text-[10px] text-zinc-300 hover:text-red-500"
                                title={t("delete")}
                              >
                                {tc("delete")}
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
              <PetAvatar
                src={selectedPet.avatar}
                alt={selectedPet.displayName || selectedPet.petName}
                className="h-14 w-14 rounded-full border border-orange-200 bg-orange-50 object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-zinc-900">
                    {selectedPet.displayName || selectedPet.petName}
                  </span>
                  <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                    Lv.{selectedPet.level}
                  </span>
                  {selectedPet.isUnlocked && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                      {tc("unlocked")}
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500">
                  {t("adoptedLine", { emoji: moodInfo(selectedPet.happiness).emoji, label: moodLabel(tchat, moodInfo(selectedPet.happiness).mood), date: selectedPet.adoptedAt ? new Date(selectedPet.adoptedAt).toLocaleDateString(locale) : "—" })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPet(null)}
                className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
                aria-label={tc("close")}
              >
                ×
              </button>
            </div>

            {/* 统计 */}
            <div className="mt-4 space-y-2">
              <div>
                <div className="mb-1 flex justify-between text-xs text-zinc-500">
                  <span>{t("mood")}</span>
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
                  <div className="text-[10px] text-zinc-400">{t("level")}</div>
                </div>
                <div className="rounded-xl bg-zinc-50 py-2">
                  <div className="text-sm font-semibold text-zinc-800">
                    {selectedPet.monthlyPoints}
                  </div>
                  <div className="text-[10px] text-zinc-400">{t("monthlyPoints")}</div>
                </div>
                <div className="rounded-xl bg-zinc-50 py-2">
                  <div className="text-sm font-semibold text-zinc-800">
                    {selectedPet.chatCount}
                  </div>
                  <div className="text-[10px] text-zinc-400">{t("chats")}</div>
                </div>
              </div>
            </div>

            {/* 记忆 */}
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
              {groupsFor(selectedPet).length === 0 ? (
                <p className="py-4 text-center text-sm text-zinc-400">
                  {t("noMemories")}
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
                            {tc("delete")}
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
                {tc("chat")}
              </button>
            )}
            {/* 情绪与特权消费：装扮商城入口 */}
            {selectedPet.threadId && (
              <button
                type="button"
                onClick={() => setShopOpen(true)}
                className="mt-2 w-full rounded-full bg-orange-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-orange-600"
              >
                🛍️ {t("shop")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 装扮商城（购买皮肤/特效 + 高级公民月卡） */}
      <CosmeticsShopModal
        open={shopOpen}
        adoptionId={selectedPet?.id ?? null}
        onClose={() => setShopOpen(false)}
      />
    </main>
  );
}

