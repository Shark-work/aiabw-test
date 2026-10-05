"use client";

/**
 * 首页「回来看看」banner（P2 社交传播 · 改动四，提升次日留存）
 *
 * 数据源 GET /api/home/recall（Bearer；未登录/失败/无提醒 → 不渲染，静默降级）。
 * 三类提醒可叠加，逐条渲染为可点击横幅：
 *  missYou（>24h 未登录）→ /my-pets；feed（最低幸福度过低）→ /my-pets；
 *  reward（集齐未领系列图鉴）→ /explore-v2。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { RecallReminder } from "@/lib/recall-config";

const STYLE: Record<RecallReminder["type"], { icon: string; href: string; cls: string }> = {
  missYou: {
    icon: "🥺",
    href: "/my-pets",
    cls: "border-rose-200 bg-gradient-to-r from-rose-50 to-pink-50 text-rose-600 dark:border-rose-900/50 dark:from-rose-950/40 dark:to-pink-950/30 dark:text-rose-300",
  },
  feed: {
    icon: "🍖",
    href: "/my-pets",
    cls: "border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 text-amber-700 dark:border-amber-900/50 dark:from-amber-950/40 dark:to-orange-950/30 dark:text-amber-300",
  },
  reward: {
    icon: "🎁",
    href: "/explore-v2",
    cls: "border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 text-violet-600 dark:border-violet-800 dark:from-violet-950/50 dark:to-fuchsia-950/40 dark:text-violet-300",
  },
};

export function RecallBanner() {
  const t = useTranslations("recall");
  const [reminders, setReminders] = useState<RecallReminder[]>([]);

  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    fetch("/api/home/recall", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.ok && Array.isArray(d.reminders)) {
          setReminders(d.reminders as RecallReminder[]);
        }
      })
      .catch(() => {
        /* banner 拉取失败不影响首页主体 */
      });
  }, []);

  if (reminders.length === 0) return null;

  return (
    <div className="space-y-2">
      {reminders.map((r) => {
        const s = STYLE[r.type] ?? STYLE.missYou;
        const text =
          r.type === "feed"
            ? t("feed", { name: r.petName ?? "" })
            : r.type === "reward"
              ? t("reward", { n: r.count ?? 0 })
              : t("missYou");
        return (
          <Link
            key={r.type}
            href={s.href}
            className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 text-sm shadow-sm transition hover:shadow-md ${s.cls}`}
          >
            <span className="font-semibold">
              {s.icon} {text}
            </span>
            <span className="shrink-0 text-xs font-semibold opacity-80">{t("cta")}</span>
          </Link>
        );
      })}
    </div>
  );
}
