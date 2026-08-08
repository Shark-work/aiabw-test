"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Handbook = {
  id: string;
  title: string | null;
  status: string;
  createdAt: string;
};

type PetOption = { id: string; petName: string };

export default function HandbooksPage() {
  const [handbooks, setHandbooks] = useState<Handbook[]>([]);
  const [pets, setPets] = useState<PetOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState<Handbook | null>(null);
  const [detail, setDetail] = useState<{ title: string | null; content: string } | null>(null);

  const token = () =>
    typeof window !== "undefined" ? localStorage.getItem("aiabw_token") : null;

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const t = token();
      if (!t) return;
      const h = await fetch("/api/handbooks", {
        headers: { Authorization: `Bearer ${t}` },
      }).then((r) => r.json());
      if (h?.ok) setHandbooks(h.handbooks ?? []);
      const p = await fetch(`/api/pets?anonymousId=`, {
        headers: { Authorization: `Bearer ${t}` },
      }).then((r) => r.json());
      if (p?.ok) setPets(p.pets.map((x: { id: string; petName: string }) => ({ id: x.id, petName: x.petName })));
    } catch {
      setError("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const pollTask = useCallback(async (taskId: string) => {
    for (let i = 0; i < 30; i++) {
      const r = await fetch(`/api/generate/handbook/${taskId}`, {
        headers: { Authorization: `Bearer ${token()}` },
      }).then((res) => res.json());
      if (r?.status === "done" || r?.status === "error") {
        await loadAll();
        setGenerating(false);
        return r;
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
    setGenerating(false);
    return null;
  }, [loadAll]);

  const handleGenerate = async () => {
    const t = token();
    if (!t || pets.length === 0) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/generate/handbook", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ adoptionId: pets[0].id }),
      });
      const data = await res.json();
      if (data?.ok && data.taskId) {
        await pollTask(data.taskId);
      } else {
        setGenerating(false);
      }
    } catch {
      setGenerating(false);
    }
  };

  const openDetail = async (hb: Handbook) => {
    setSelected(hb);
    const r = await fetch(`/api/generate/handbook/${hb.id}`, {
      headers: { Authorization: `Bearer ${token()}` },
    }).then((res) => res.json());
    setDetail(r?.ok ? { title: r.title, content: r.content ?? "" } : null);
  };

  const t = token();

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">记忆手账</h1>
            <p className="text-xs text-zinc-500">
              把和宠物相处的点滴，生成一本温暖的记忆手账~
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !t || pets.length === 0}
              className="rounded-full bg-orange-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {generating ? "⏳ 生成中（后台进行）..." : "📔 为第一只宠物生成手账"}
            </button>
            <Link
              href="/my-pets"
              className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
            >
              我的宠物
            </Link>
          </div>
        </div>

        {!t && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-700">
            请先{" "}
            <Link href="/login?redirect=/handbooks" className="font-medium underline">
              登录
            </Link>{" "}
            查看你的记忆手账
          </div>
        )}

        {loading && <p className="py-10 text-center text-sm text-zinc-400">加载中…</p>}
        {error && <p className="py-10 text-center text-sm text-red-600">{error}</p>}
        {!loading && !error && t && handbooks.length === 0 && (
          <p className="py-10 text-center text-sm text-zinc-400">
            还没有手账，点上方按钮为第一只宠物生成一本吧~
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {handbooks.map((hb) => (
            <button
              key={hb.id}
              type="button"
              onClick={() => openDetail(hb)}
              className="rounded-2xl border border-zinc-200 bg-white/90 p-4 text-left shadow-sm backdrop-blur transition hover:border-orange-300"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-900">
                  {hb.title ?? "（生成中）"}
                </span>
                {hb.status === "processing" || hb.status === "generating" ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    生成中
                  </span>
                ) : null}
                {hb.status === "error" && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600">
                    失败
                  </span>
                )}
                {hb.status === "done" && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    完成
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-zinc-400">
                {new Date(hb.createdAt).toLocaleString()}
              </div>
            </button>
          ))}
        </div>

        {selected && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-900/50 p-4 backdrop-blur-sm"
            onClick={() => {
              setSelected(null);
              setDetail(null);
            }}
          >
            <div
              className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-zinc-900">
                  {detail?.title ?? "记忆手账"}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setDetail(null);
                  }}
                  className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
                  aria-label="关闭"
                >
                  ×
                </button>
              </div>
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-zinc-700">
                {detail?.content ?? "加载中…"}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
