"use client";

/**
 * 🎁 限时特惠横幅（Phase 7 · 7.6-1，/shop 与装扮弹窗共用）：
 *  - 三态口径（全部复用 Phase 4/6 既有真实商品，不虚构折扣）：
 *      未登录  → 「首充双倍 · 新用户专享」（点击 → 事件总线 → 自动跳登录）；
 *      已登录未首充 → 「首充双倍 · 仅限一次」（点击 → 首充特惠弹窗）；
 *      已首充  → 「积分补给 · 充值特惠」（点击 → 常规充值弹窗）。
 *  - 点击统一走 Phase 4 事件总线 notifyPointsInsufficient({})：首充/常规/未登录分流
 *    由 PointsRechargeHost 既有逻辑处理，本组件零支付逻辑；
 *  - 状态查询复用 GET /api/user/first-purchase/status（失败保守按已首充文案，不误标双倍）。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { notifyPointsInsufficient } from "@/lib/points-entry";

type OfferState = "guest" | "firstPurchase" | "normal";

export function LimitedOfferBanner({ className = "" }: { className?: string }) {
  const t = useTranslations("offerBanner");
  const [offer, setOffer] = useState<OfferState>("guest");

  useEffect(() => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("aiabw_token") : null;
    if (!token) {
      setOffer("guest");
      return;
    }
    let alive = true;
    fetch("/api/user/first-purchase/status", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        // 失败保守按已首充（不误标双倍）；isFirstPurchase=true 表示尚未首充可享双倍
        setOffer(d?.ok && d.isFirstPurchase ? "firstPurchase" : "normal");
      })
      .catch(() => alive && setOffer("normal"));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <button
      type="button"
      onClick={() => notifyPointsInsufficient({})}
      className={`flex w-full items-center justify-between gap-2 rounded-xl border border-rose-200 bg-gradient-to-r from-rose-50 to-orange-50 px-3 py-2 text-left shadow-sm transition hover:border-rose-300 hover:shadow ${className}`}
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-bold text-rose-600">
          {offer === "firstPurchase"
            ? t("firstTitle")
            : offer === "guest"
              ? t("guestTitle")
              : t("normalTitle")}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-rose-400">
          {offer === "firstPurchase"
            ? t("firstSubtitle")
            : offer === "guest"
              ? t("guestSubtitle")
              : t("normalSubtitle")}
        </span>
      </span>
      <span className="shrink-0 rounded-full bg-rose-500 px-3 py-1 text-[11px] font-semibold text-white shadow-sm">
        {t("cta")}
      </span>
    </button>
  );
}
