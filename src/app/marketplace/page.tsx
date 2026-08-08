"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
      else setError(data?.error ?? "加载失败");
      const token = localStorage.getItem("aiabw_token");
      if (token) {
        const me = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json());
        if (me?.ok) setIsCreator(!!me.user?.isCreator);
      }
    } catch {
      setError("网络错误，请稍后重试");
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
        showToast("🎉 恭喜！你现在是创作者了，可以发布自己的艾比~");
      } else {
        showToast(data?.error ?? "申请失败");
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
        showToast("🎉 购买成功！宠物已入住你的艾比世界~");
        router.push(`/chat?thread=${data.threadId}&adopt=${data.adoption?.id}`);
      } else {
        showToast(data?.error ?? "购买失败");
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
      showToast("请填写完整信息");
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
        showToast("🎉 发布成功！你的艾比已上架~");
        setPublishOpen(false);
        setPublishForm({ name: "", imageUrl: "", systemPrompt: "", priceOrPoints: "0" });
        load();
      } else {
        showToast(data?.error ?? "发布失败");
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
        showToast(`🎁 盲盒开出「${data.petName}」！`);
        router.push(`/chat?thread=${data.threadId}&adopt=${data.adoption?.id}`);
      } else {
        showToast(data?.error ?? "抽取失败");
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
            <h1 className="text-xl font-semibold text-zinc-900">UGC 广场</h1>
            <p className="text-xs text-zinc-500">
              来自创作者的独特艾比，用积分把它们带回家~
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleGacha}
              disabled={busy}
              className="rounded-full bg-fuchsia-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-fuchsia-600 disabled:opacity-60"
            >
              🎁 盲盒抽取
            </button>
            {isCreator ? (
              <button
                type="button"
                onClick={() => setPublishOpen(true)}
                className="rounded-full bg-violet-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-violet-600"
              >
                ➕ 发布 UGC 宠物
              </button>
            ) : (
              <button
                type="button"
                onClick={handleApplyCreator}
                disabled={busy}
                className="rounded-full border border-violet-300 bg-white px-4 py-1.5 text-sm font-medium text-violet-600 transition hover:bg-violet-50 disabled:opacity-60"
              >
                ✨ 申请成为创作者
              </button>
            )}
            <Link
              href="/my-pets"
              className="rounded-full bg-orange-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-orange-600"
            >
              🐾 我的宠物
            </Link>
          </div>
        </div>

        {toast && (
          <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-sm text-emerald-700">
            {toast}
          </div>
        )}

        {loading && <p className="py-10 text-center text-sm text-zinc-400">加载中…</p>}
        {error && <p className="py-10 text-center text-sm text-red-600">{error}</p>}
        {!loading && !error && pets.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-zinc-500">还没有 UGC 宠物，成为创作者发布第一只吧~</p>
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
                    创作者：{pet.creatorEmail ?? "未知"}
                  </div>
                  <div className="text-sm font-medium text-violet-600">
                    {pet.priceOrPoints} 积分
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleBuy(pet.id)}
                  disabled={busy}
                  className="shrink-0 rounded-full bg-violet-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-600 disabled:opacity-60"
                >
                  购买
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
              <h3 className="text-lg font-bold text-zinc-900">➕ 发布 UGC 宠物</h3>
              <button
                type="button"
                onClick={() => setPublishOpen(false)}
                className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                value={publishForm.name}
                onChange={(e) => setPublishForm({ ...publishForm, name: e.target.value })}
                placeholder="宠物名字（如：小幽灵）"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
              />
              <input
                type="text"
                value={publishForm.imageUrl}
                onChange={(e) => setPublishForm({ ...publishForm, imageUrl: e.target.value })}
                placeholder="头像图片地址（如 /resources/pet/qapi.png）"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
              />
              <textarea
                value={publishForm.systemPrompt}
                onChange={(e) => setPublishForm({ ...publishForm, systemPrompt: e.target.value })}
                placeholder="系统提示词：定义它的性格、说话风格……"
                rows={4}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
              />
              <input
                type="number"
                min={0}
                value={publishForm.priceOrPoints}
                onChange={(e) => setPublishForm({ ...publishForm, priceOrPoints: e.target.value })}
                placeholder="售价（积分）"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishBusy}
                className="w-full rounded-full bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:opacity-60"
              >
                {publishBusy ? "发布中..." : "发布"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
