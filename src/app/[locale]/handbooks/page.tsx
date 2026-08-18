"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

type Handbook = {
  id: string;
  title: string | null;
  status: string;
  createdAt: string;
};

type PetOption = { id: string; petName: string };

export default function HandbooksPage() {
  const trans = useTranslations("handbooks");
  const tc = useTranslations("common");
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
      const tk = token();
      if (!tk) return;
      const h = await fetch("/api/handbooks", {
        headers: { Authorization: `Bearer ${tk}` },
      }).then((r) => r.json());
      if (h?.ok) setHandbooks(h.handbooks ?? []);
      const p = await fetch(`/api/pets?anonymousId=`, {
        headers: { Authorization: `Bearer ${tk}` },
      }).then((r) => r.json());
      if (p?.ok) setPets(p.pets.map((x: { id: string; petName: string }) => ({ id: x.id, petName: x.petName })));
    } catch {
      setError(tc("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [tc]);

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
    const tk = token();
    if (!tk || pets.length === 0) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/generate/handbook", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` },
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

  const authToken = token();

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">{trans("title")}</h1>
            <p className="text-xs text-zinc-500">
              {trans("subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !authToken || pets.length === 0}
              className="rounded-full bg-orange-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {generating ? trans("generating") : trans("generate")}
            </button>
            <Link
              href="/my-pets"
              className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
            >
              {trans("myPets")}
            </Link>
          </div>
        </div>

        {!authToken && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-700">
            <Link href="/login?redirect=/handbooks" className="font-medium underline">
              {tc("signIn")}
            </Link>
            {" "}{trans("loginHint")}
          </div>
        )}

        {loading && <p className="py-10 text-center text-sm text-zinc-400">{tc("loading")}</p>}
        {error && <p className="py-10 text-center text-sm text-red-600">{error}</p>}
        {!loading && !error && authToken && handbooks.length === 0 && (
          <p className="py-10 text-center text-sm text-zinc-400">
            {trans("empty")}
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
                  {hb.title ?? trans("generatingPlaceholder")}
                </span>
                {hb.status === "processing" || hb.status === "generating" ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    {trans("statusGenerating")}
                  </span>
                ) : null}
                {hb.status === "error" && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600">
                    {trans("statusFailed")}
                  </span>
                )}
                {hb.status === "done" && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    {trans("statusDone")}
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
                  {detail?.title ?? trans("detailTitle")}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setDetail(null);
                  }}
                  className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
                  aria-label={tc("close")}
                >
                  ×
                </button>
              </div>
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-zinc-700">
                {detail?.content ?? tc("loading")}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
