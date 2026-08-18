"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UpgradePetModal } from "@/components/upgrade-pet-modal";

type UgcPet = {
  id: string;
  name: string;
  imageUrl: string;
  priceOrPoints: number;
  creatorEmail: string | null;
};

export default function MarketplacePage() {
  const router = useRouter();
  const [pets, setPets] = useState<UgcPet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [isCreator, setIsCreator] = useState(false);
  // 单宠限制 → 解锁弹窗
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [unlockAdoptionId, setUnlockAdoptionId] = useState<string | null>(null);
  const [upgradePetCount, setUpgradePetCount] = useState(1);
  // UGC 发布表单
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishForm, setPublishForm] = useState({
    name: "",
    imageUrl: "",
    systemPrompt: "",
    priceOrPoints: "0",
  });

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("aiabw_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/creator/pets");
      const data = await res.json();
      if (data?.ok) setPets(data.pets ?? []);
      else setError(data?.error ?? "Failed to load");
      const token = localStorage.getItem("aiabw_token");
      if (token) {
        const me = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json());
        if (me?.ok) setIsCreator(!!me.user?.isCreator);
      }
    } catch {
      setError("Network error, please try again");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleApplyCreator = async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) {
      router.push("/login?redirect=/marketplace");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/creator/apply", {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data?.ok) {
        setIsCreator(true);
        showToast("🎉 Congratulations! You are now a creator and can publish your own Aibi pets.");
      } else {
        showToast(data?.error ?? "Application failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleBuy = async (petId: string) => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) {
      router.push("/login?redirect=/marketplace");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/pet/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ petId }),
      });
      const data = await res.json();
      if (data?.ok && data.threadId) {
        showToast("🎉 Purchase successful! Your new pet has moved into Aibi World.");
        router.push(`/chat?thread=${data.threadId}&adopt=${data.adoption?.id}`);
      } else if (data?.needPayment === true) {
        setUpgradeOpen(true);
        setUnlockAdoptionId(data.unlockAdoptionId ?? null);
        setUpgradePetCount(data.petCount ?? 1);
        showToast(data.error ?? "Please unlock the Multi-Pet Collection first");
      } else {
        showToast(data?.error ?? "Purchase failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    if (
      !publishForm.name.trim() ||
      !publishForm.imageUrl.trim() ||
      !publishForm.systemPrompt.trim()
    ) {
      showToast("Please fill in all the required fields");
      return;
    }
    setPublishBusy(true);
    try {
      const res = await fetch("/api/creator/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: publishForm.name.trim(),
          imageUrl: publishForm.imageUrl.trim(),
          systemPrompt: publishForm.systemPrompt.trim(),
          priceOrPoints: Number(publishForm.priceOrPoints) || 0,
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        showToast("🎉 Published! Your Aibi pet is now on the market.");
        setPublishOpen(false);
        setPublishForm({ name: "", imageUrl: "", systemPrompt: "", priceOrPoints: "0" });
        load();
      } else {
        showToast(data?.error ?? "Publish failed");
      }
    } finally {
      setPublishBusy(false);
    }
  };

  const handleGacha = async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) {
      router.push("/login?redirect=/marketplace");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/gacha/draw", {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data?.ok && data.threadId) {
        showToast(`🎁 Mystery box opened: "${data.petName}"!`);
        router.push(`/chat?thread=${data.threadId}&adopt=${data.adoption?.id}`);
      } else if (data?.needPayment === true) {
        setUpgradeOpen(true);
        setUnlockAdoptionId(data.unlockAdoptionId ?? null);
        setUpgradePetCount(data.petCount ?? 1);
        showToast(data.error ?? "Please unlock the Multi-Pet Collection first");
      } else {
        showToast(data?.error ?? "Draw failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">UGC Market</h1>
            <p className="text-xs text-zinc-500">
              Unique Aibi pets from creators - take them home with points.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleGacha}
              disabled={busy}
              className="rounded-full bg-fuchsia-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-fuchsia-600 disabled:opacity-60"
            >
              🎁 Mystery box
            </button>
            {isCreator ? (
              <button
                type="button"
                onClick={() => setPublishOpen(true)}
                className="rounded-full bg-violet-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-violet-600"
              >
                ➕ Publish UGC pet
              </button>
            ) : (
              <button
                type="button"
                onClick={handleApplyCreator}
                disabled={busy}
                className="rounded-full border border-violet-300 bg-white px-4 py-1.5 text-sm font-medium text-violet-600 transition hover:bg-violet-50 disabled:opacity-60"
              >
                ✨ Become a creator
              </button>
            )}
            <Link
              href="/my-pets"
              className="rounded-full bg-orange-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-orange-600"
            >
              🐾 My pets
            </Link>
          </div>
        </div>

        {toast && (
          <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-sm text-emerald-700">
            {toast}
          </div>
        )}

        {loading && <p className="py-10 text-center text-sm text-zinc-400">Loading…</p>}
        {error && <p className="py-10 text-center text-sm text-red-600">{error}</p>}
        {!loading && !error && pets.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-zinc-500">No UGC pets yet - become a creator and publish the first one!</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {pets.map((pet) => (
            <div
              key={pet.id}
              className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm backdrop-blur"
            >
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pet.imageUrl}
                  alt={pet.name}
                  className="h-14 w-14 rounded-full border border-orange-200 bg-orange-50 object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-zinc-900">{pet.name}</div>
                  <div className="text-xs text-zinc-500">
                    Creator: {pet.creatorEmail ?? "unknown"}
                  </div>
                  <div className="text-sm font-medium text-violet-600">
                    {pet.priceOrPoints} points
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleBuy(pet.id)}
                  disabled={busy}
                  className="shrink-0 rounded-full bg-violet-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-600 disabled:opacity-60"
                >
                  Buy
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {publishOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-900/50 p-4 backdrop-blur-sm"
          onClick={() => setPublishOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-zinc-900">➕ Publish UGC pet</h3>
              <button
                type="button"
                onClick={() => setPublishOpen(false)}
                className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                value={publishForm.name}
                onChange={(e) => setPublishForm({ ...publishForm, name: e.target.value })}
                placeholder="Pet name (e.g. Little Ghost)"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
              />
              <input
                type="text"
                value={publishForm.imageUrl}
                onChange={(e) => setPublishForm({ ...publishForm, imageUrl: e.target.value })}
                placeholder="Avatar image URL (e.g. /resources/pet/qapi.png)"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
              />
              <textarea
                value={publishForm.systemPrompt}
                onChange={(e) => setPublishForm({ ...publishForm, systemPrompt: e.target.value })}
                placeholder="System prompt: define its personality, speaking style..."
                rows={4}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
              />
              <input
                type="number"
                min={0}
                value={publishForm.priceOrPoints}
                onChange={(e) => setPublishForm({ ...publishForm, priceOrPoints: e.target.value })}
                placeholder="Price (points)"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishBusy}
                className="w-full rounded-full bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:opacity-60"
              >
                {publishBusy ? "Publishing..." : "Publish"}
              </button>
            </div>
          </div>
        </div>
      )}

      <UpgradePetModal
        open={upgradeOpen}
        adoptionId={unlockAdoptionId}
        petCount={upgradePetCount}
        onClose={() => setUpgradeOpen(false)}
        onUnlocked={() => {
          setUpgradeOpen(false);
          void load();
        }}
      />
    </main>
  );
}
