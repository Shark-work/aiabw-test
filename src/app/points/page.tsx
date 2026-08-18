"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Log = { id: string; amount: number; reason: string; createdAt: string };

const REASON_LABEL: Record<string, string> = {
  checkin: "Daily check-in",
  gacha: "Mystery box draw",
  ugc_buy: "UGC pet purchase",
};

export default function PointsPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = localStorage.getItem("aiabw_token");
      if (!token) return;
      const res = await fetch("/api/points-log", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.ok) setLogs(data.logs ?? []);
      else setError(data?.error ?? "Failed to load");
    } catch {
      setError("Network error, please try again");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const total = logs.reduce((s, l) => s + l.amount, 0);

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 sm:p-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">Points history</h1>
            <p className="text-xs text-zinc-500">
              Last 50 entries · Total {total > 0 ? "+" : ""}
              {total}
            </p>
          </div>
          <Link
            href="/my-pets"
            className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
          >
            Back
          </Link>
        </div>

        {loading && <p className="py-10 text-center text-sm text-zinc-400">Loading…</p>}
        {error && <p className="py-10 text-center text-sm text-red-600">{error}</p>}
        {!loading && !error && logs.length === 0 && (
          <p className="py-10 text-center text-sm text-zinc-400">No points records yet.</p>
        )}

        <div className="space-y-2">
          {logs.map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between rounded-xl border border-zinc-100 bg-white/90 px-4 py-2.5 shadow-sm"
            >
              <div>
                <div className="text-sm font-medium text-zinc-700">
                  {REASON_LABEL[l.reason] ?? l.reason}
                </div>
                <div className="text-xs text-zinc-400">
                  {new Date(l.createdAt).toLocaleString()}
                </div>
              </div>
              <span
                className={`font-semibold ${
                  l.amount >= 0 ? "text-emerald-600" : "text-red-500"
                }`}
              >
                {l.amount >= 0 ? "+" : ""}
                {l.amount}
              </span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
