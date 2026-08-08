"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Log = { id: string; amount: number; reason: string; createdAt: string };

const REASON_LABEL: Record<string, string> = {
  checkin: "每日签到",
  gacha: "盲盒抽取",
  ugc_buy: "购买 UGC 宠物",
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
      else setError(data?.error ?? "加载失败");
    } catch {
      setError("网络错误，请稍后重试");
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
            <h1 className="text-xl font-semibold text-zinc-900">积分明细</h1>
            <p className="text-xs text-zinc-500">
              近 50 条记录 · 合计 {total > 0 ? "+" : ""}
              {total}
            </p>
          </div>
          <Link
            href="/my-pets"
            className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
          >
            返回
          </Link>
        </div>

        {loading && <p className="py-10 text-center text-sm text-zinc-400">加载中…</p>}
        {error && <p className="py-10 text-center text-sm text-red-600">{error}</p>}
        {!loading && !error && logs.length === 0 && (
          <p className="py-10 text-center text-sm text-zinc-400">还没有积分记录~</p>
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
