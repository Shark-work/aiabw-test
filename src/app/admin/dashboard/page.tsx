"use client";

import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui/toast";

type Stats = { totalUsers: number; todayUsers: number; totalVisits: number; todayFusions: number };

const CARDS: { key: keyof Stats; label: string; suffix: string }[] = [
  { key: "totalUsers", label: "总用户数", suffix: "人" },
  { key: "todayUsers", label: "今日新增", suffix: "人" },
  { key: "totalVisits", label: "累计访问量", suffix: "次" },
  { key: "todayFusions", label: "今日合成次数", suffix: "次" },
];

/** 📊 数据看板：核心运营指标。 */
export default function AdminDashboardPage() {
  const { toast, toastsNode } = useToast();
  // toast 对象每次渲染新建（引用不稳定），用 ref 持有稳定访问，避免 deps 循环。
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    fetch("/api/admin/stats", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) setStats(d.stats);
        else toastRef.current.error(d?.error ?? "加载失败");
      })
      .catch(() => toastRef.current.error("网络错误"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      {toastsNode}
      <h1 className="text-lg font-bold text-zinc-900">📊 数据看板</h1>
      <p className="mt-0.5 text-xs text-zinc-400">核心运营指标总览</p>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {CARDS.map((c) => (
          <div key={c.key} className="rounded-xl border border-zinc-200 bg-white p-4">
            <p className="text-xs text-zinc-400">{c.label}</p>
            <p className="mt-1 text-2xl font-bold text-zinc-900">
              {loading ? "—" : (stats?.[c.key] ?? 0).toLocaleString("en-US")}
              <span className="ml-1 text-xs font-normal text-zinc-400">{c.suffix}</span>
            </p>
          </div>
        ))}
      </div>

      {loading && <p className="mt-6 text-sm text-zinc-400">加载中…</p>}
    </div>
  );
}
