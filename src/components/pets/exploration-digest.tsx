"use client";

/**
 * 灵宠「探索履历」区块（/pets/my 伙伴详情区内，P1 故事外显 · 改动四）：
 * 展示最近 5 次探索的产出（明信片/道具/知识/奇遇/休息），
 * 奇遇（is_rare）带高亮标记；累计探索次数经灵魂卡 story 进入卡面（改动二已用）。
 *
 * 数据源 GET /api/exploration/history?limit=5（复用现有接口，用户维度——
 * V2 探索为灵宠陪伴下的共同经历，与成就系统同口径）。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

type DigestRecord = {
  id: string;
  resultType: string;
  title: string;
  emoji: string | null;
  isRare: boolean;
  createdAt: string;
};

export function ExplorationDigest() {
  const t = useTranslations("myPets.digest");
  const [records, setRecords] = useState<DigestRecord[] | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) {
      setRecords([]);
      return;
    }
    fetch("/api/exploration/history?limit=5", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.ok) setRecords((d.records ?? []) as DigestRecord[]);
        else setRecords([]);
      })
      .catch(() => setRecords([]));
  }, []);

  // 未登录/加载中/接口失败 → 不渲染（详情区不打扰）
  if (!records) return null;

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-500">{t("title")}</span>
      </div>
      {records.length === 0 ? (
        <p className="rounded-xl bg-zinc-50 px-3 py-2.5 text-center text-xs text-zinc-400 dark:bg-zinc-800/60">
          {t("empty")}{" "}
          <Link href="/explore-v2" className="font-medium text-violet-500 hover:underline">
            {t("emptyCta")}
          </Link>
        </p>
      ) : (
        <ul className="space-y-1.5">
          {records.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-2 rounded-xl border border-zinc-100 bg-zinc-50/60 px-2.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-800/40"
            >
              <span className="shrink-0 text-base" aria-hidden>
                {r.emoji ?? "🐾"}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-700 dark:text-zinc-200">
                {r.title}
              </span>
              {r.isRare ? (
                <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  ✨ {t("rare")}
                </span>
              ) : null}
              <span className="shrink-0 text-[10px] text-zinc-400">
                {new Date(r.createdAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
