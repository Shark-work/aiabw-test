"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { DiagnosticForm } from "@/components/diagnostic-form";
import { UpgradePetModal } from "@/components/upgrade-pet-modal";
import { PETS, type PetType } from "@/lib/pet-config";
import { getAnonymousId } from "@/lib/anon-id";

export default function Home() {
  const router = useRouter();
  const [adoptingType, setAdoptingType] = useState<PetType | null>(null);
  const [error, setError] = useState("");
  const [user, setUser] = useState<{
    id: string;
    email: string;
    points: number;
    isCreator: boolean;
  } | null>(null);
  // 单宠限制：用户已有宠物数量 / 是否已解锁 / 可用于支付的宠物 id
  const [petState, setPetState] = useState<{
    petCount: number;
    hasUnlocked: boolean;
    unlockAdoptionId: string | null;
  }>({ petCount: 0, hasUnlocked: false, unlockAdoptionId: null });
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const petLimitReached = petState.petCount >= 1 && !petState.hasUnlocked;

  // 从 localStorage 恢复登录态
  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.ok && data.user) {
          setUser({
            id: data.user.id,
            email: data.user.email,
            points: data.user.points ?? 0,
            isCreator: !!data.user.isCreator,
          });
        } else {
          localStorage.removeItem("aiabw_token");
        }
      })
      .catch(() => {});
  }, []);

  // 读取当前用户宠物数量 / 解锁状态（单宠限制前端提示）
  const refreshPetState = useCallback(async () => {
    const token = localStorage.getItem("aiabw_token");
    const anonymousId = getAnonymousId();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const res = await fetch(
        `/api/pets${!token && anonymousId ? `?anonymousId=${encodeURIComponent(anonymousId)}` : ""}`,
        { headers },
      );
      const data = await res.json();
      if (data?.ok && Array.isArray(data.pets)) {
        const pets = data.pets as { id: string; isUnlocked: boolean }[];
        setPetState({
          petCount: pets.length,
          hasUnlocked: pets.some((p) => p.isUnlocked),
          unlockAdoptionId: pets[0]?.id ?? null,
        });
      }
    } catch {
      // 静默失败，不影响页面
    }
  }, []);

  useEffect(() => {
    void refreshPetState();
  }, [refreshPetState]);

  const handleLogout = () => {
    localStorage.removeItem("aiabw_token");
    setUser(null);
  };

  const handleCheckin = async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    try {
      const res = await fetch("/api/user/checkin", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.ok) {
        setUser((prev) => (prev ? { ...prev, points: data.points ?? prev.points } : prev));
        alert(data.already ? "You already checked in today. See you tomorrow!" : "🎉 Check-in success +10 points!");
      } else {
        alert(data?.error ?? "Check-in failed");
      }
    } catch {
      alert("Network error, please try again");
    }
  };

  const handleApplyCreator = async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    try {
      const res = await fetch("/api/creator/apply", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.ok) {
        setUser((prev) => (prev ? { ...prev, isCreator: true } : prev));
        alert("🎉 Congratulations! You are now a creator and can publish UGC pets.");
      } else {
        alert(data?.error ?? "Application failed");
      }
    } catch {
      alert("Network error, please try again");
    }
  };

  const handleAdopt = async (petType: PetType) => {
    if (adoptingType) return;
    setAdoptingType(petType);
    setError("");

    try {
      const token = localStorage.getItem("aiabw_token");
      const anonymousId = getAnonymousId();
      const res = await fetch("/api/adopt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          petType,
          ...(anonymousId ? { anonymousId } : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Single-pet rule: guide the user to the paid unlock flow
        if (data?.needPayment === true) {
          setError(data.error || "Please unlock the Multi-Pet Collection first");
          if (data.unlockAdoptionId) {
            setPetState((prev) => ({
              ...prev,
              petCount: data.petCount ?? prev.petCount,
              hasUnlocked: false,
              unlockAdoptionId: data.unlockAdoptionId,
            }));
          }
          setUpgradeOpen(true);
          return;
        }
        throw new Error(data.error || "Adoption failed, please try again");
      }

      // Adoption success → open the dedicated chat page for the new thread & adoption
      if (data.ok && data.threadId) {
        router.push(
          `/chat?thread=${data.threadId}&adopt=${data.adoption?.id ?? ""}`,
        );
      } else {
        router.push("/chat");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adoption failed, please try again");
      setAdoptingType(null);
    }
  };

  const petEntries = Object.entries(PETS) as [PetType, (typeof PETS)[PetType]][];

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden p-4 sm:p-6">
      {/* 艾比世界背景图 */}
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: "url('/resources/background_clothing/bg1.png')",
        }}
      />
      {/* 半透明白色遮罩，保证内容可读 */}
      <div aria-hidden className="absolute inset-0 bg-white/60" />

      {/* 账号入口 */}
      <div className="relative z-20 flex justify-end px-2 pt-2">
        {user ? (
          <div className="flex flex-wrap items-center justify-end gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-1.5 text-sm shadow-sm backdrop-blur">
            <span className="font-medium text-violet-600">
              <Link href="/points" className="hover:underline" title="Points history">
                Points {user.points}
              </Link>
            </span>
            <button
              type="button"
              onClick={handleCheckin}
              className="font-medium text-emerald-600 hover:underline"
            >
              📅 Check-in +10
            </button>
            {!user.isCreator && (
              <button
                type="button"
                onClick={handleApplyCreator}
                className="font-medium text-violet-600 hover:underline"
              >
                ✨ Become a creator
              </button>
            )}
            <Link
              href="/marketplace"
              className="font-medium text-zinc-600 hover:text-orange-600"
            >
              🛍️ Market
            </Link>
            <Link
              href="/handbooks"
              className="font-medium text-zinc-600 hover:text-orange-600"
            >
              📔 Journals
            </Link>
            <Link
              href="/my-pets"
              className="font-medium text-zinc-600 hover:text-orange-600"
            >
              🐾 My pets
            </Link>
            <span className="text-zinc-300">|</span>
            <span className="text-zinc-600">{user.email}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="font-medium text-orange-600 hover:underline"
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-full border border-zinc-200 bg-white/80 px-4 py-1.5 text-sm shadow-sm backdrop-blur">
            <Link
              href="/marketplace"
              className="font-medium text-zinc-600 hover:text-orange-600"
            >
              🛍️ Market
            </Link>
            <span className="text-zinc-300">|</span>
            <Link href="/login" className="font-medium text-zinc-600 hover:text-orange-600">
              Sign in
            </Link>
            <span className="text-zinc-300">|</span>
            <Link href="/register" className="font-medium text-orange-600 hover:underline">
              Register
            </Link>
          </div>
        )}
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
            Aibi World · Multi-Pet Collection
          </h1>
          <p className="text-sm text-zinc-600">
            Pick a companion you love, chat with it, and help it grow.
          </p>
        </div>

        {/* 宠物选择卡片 */}
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
          {petEntries.map(([petType, pet]) => {
            const busy = adoptingType === petType;
            return (
              <button
                key={petType}
                type="button"
                onClick={() =>
                  petLimitReached ? setUpgradeOpen(true) : handleAdopt(petType)
                }
                disabled={adoptingType !== null}
                className="group flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white/80 p-5 text-center shadow-sm backdrop-blur transition hover:scale-[1.03] hover:border-orange-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pet.avatar}
                  alt={`Aibi-${pet.name}`}
                  className="h-24 w-24 rounded-full border-4 border-orange-200 bg-orange-50 object-cover shadow-lg transition group-hover:scale-105"
                />
                <div className="space-y-1">
                  <div className="text-lg font-semibold text-zinc-900">
                    {pet.name}
                  </div>
                  <div className="text-xs text-zinc-500">{pet.personality}</div>
                </div>
                <span
                  className={`rounded-full px-5 py-2 text-sm font-semibold text-white shadow transition ${
                    petLimitReached
                      ? "bg-zinc-400 group-hover:bg-zinc-500"
                      : "bg-orange-500 group-hover:bg-orange-600"
                  }`}
                >
                  {busy
                    ? "⏳ Crafting..."
                    : petLimitReached
                      ? "🔒 Upgrade"
                      : "🐾 Adopt"}
                </span>
              </button>
            );
          })}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <p className="text-xs text-zinc-400">
          After adopting, you&apos;ll enter Aibi World and start chatting with your companion.
        </p>

        {/* 次要功能：旧版 AI 工具诊断 */}
        <details className="mt-6 w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white/70 p-4 text-left shadow-sm backdrop-blur">
          <summary className="cursor-pointer text-sm font-medium text-zinc-700">
            🔧 Advanced: AI tool diagnostics (legacy)
          </summary>
          <div className="mt-4">
            <DiagnosticForm />
          </div>
        </details>
      </div>

      <UpgradePetModal
        open={upgradeOpen}
        adoptionId={petState.unlockAdoptionId}
        petCount={petState.petCount}
        onClose={() => setUpgradeOpen(false)}
        onUnlocked={() => {
          void refreshPetState();
          setError("");
        }}
      />
    </main>
  );
}

