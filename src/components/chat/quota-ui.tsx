"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export type QuotaState = {
  messageCount: number;
  dailyLimit: number;
  status: "normal" | "soft_warn" | "hard_limit" | "vip";
  remaining: number;
  isVip: boolean;
  /** 仅 hard_limit 时由 /api/chat 给出；用于弹窗文案 */
  message?: string;
};

export type QuotaWarning = {
  status: "normal" | "soft_warn" | "hard_limit" | "vip";
  remaining: number;
  message: string;
};

const POLL_INTERVAL_MS = 30_000;

/**
 * QuotaBadge：聊天页顶部常驻额度徽章
 *  - VIP：💎 ∞
 *  - Free：💬 {used}/{total}
 *  - 每 30s 自动轮询 /api/chat/quota
 */
export function QuotaBadge({ initial }: { initial: QuotaState }) {
  const t = useTranslations("quota");
  const [state, setState] = useState<QuotaState>(initial);

  useEffect(() => {
    let aborted = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/chat/quota", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (aborted || !data?.ok) return;
        setState((prev) => ({ ...prev, ...data, message: prev.message }));
      } catch {
        /* ignore */
      }
    };
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      aborted = true;
      clearInterval(timer);
    };
  }, []);

  if (state.isVip) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
        {t("badge.vip")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">
      {t("badge.free", { used: state.messageCount, total: state.dailyLimit })}
    </span>
  );
}

/**
 * QuotaSoftWarn：聊天输入框上方的软提醒条（80% 触发）
 *  - 仅当 status === 'soft_warn' 时显示
 */
export function QuotaSoftWarn({ warning }: { warning: QuotaWarning | null }) {
  const t = useTranslations("quota");
  if (!warning || warning.status !== "soft_warn") return null;
  return (
    <div className="mb-2 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:text-sm">
      <span className="text-base">⚠️</span>
      <span className="flex-1">{warning.message}</span>
      <Link
        href="/subscribe"
        className="shrink-0 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-600"
      >
        {t("upgrade")}
      </Link>
    </div>
  );
}

/**
 * QuotaUpgradeModal：硬限制弹窗（429 触发）
 *  - onClose：用户关闭弹窗
 *  - quota：来自 /api/chat 的 429 响应
 */
export function QuotaUpgradeModal({
  quota,
  onClose,
}: {
  quota: QuotaState | null;
  onClose: () => void;
}) {
  const t = useTranslations("quota");
  if (!quota || quota.status !== "hard_limit") return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="bg-gradient-to-br from-amber-400 via-orange-400 to-pink-400 p-6 text-center text-white">
          <div className="text-5xl">🥺</div>
          <h3 className="mt-2 text-lg font-bold">{t("hardLimit")}</h3>
          <p className="mt-1 text-sm text-white/90">{quota.message ?? t("upgradeHint")}</p>
        </div>
        <div className="p-6">
          <div className="mb-4">
            <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
              <span>{t("used")}</span>
              <span>
                {quota.messageCount}/{quota.dailyLimit}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-rose-500"
                style={{ width: `${Math.min(100, (quota.messageCount / Math.max(1, quota.dailyLimit)) * 100)}%` }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Link
              href="/subscribe"
              className="block w-full rounded-full bg-gradient-to-r from-amber-500 to-pink-500 px-4 py-2.5 text-center text-sm font-semibold text-white hover:opacity-90"
            >
              {t("upgrade")}
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="block w-full rounded-full border border-zinc-200 bg-white px-4 py-2.5 text-center text-sm text-zinc-600 hover:bg-zinc-50"
            >
              {t("comebackTomorrow")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
