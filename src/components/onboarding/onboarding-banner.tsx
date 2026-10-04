"use client";

/**
 * 首页顶部轻量 banner（P1 故事外显）：
 * 未完成「唤醒仪式」且尚无灵宠的登录用户展示「你的灵宠还在沉睡」，点击继续引导。
 *
 * 登录门槛与 explore-v2 同策略：登录态只存 localStorage aiabw_token（客户端判定），
 * 无 token / 拉取失败 / 已完成 / 已有灵宠 → 不渲染（静默降级，不影响首页主体）。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

export function OnboardingBanner() {
  const t = useTranslations("onboarding.banner");
  const [show, setShow] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    fetch("/api/onboarding", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.ok && !d.completed && !d.hasPet) setShow(true);
      })
      .catch(() => {
        /* banner 拉取失败不影响首页主体 */
      });
  }, []);

  if (!show) return null;

  return (
    <Link
      href="/onboarding"
      className="flex items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 px-4 py-2.5 text-sm shadow-sm transition hover:shadow-md dark:border-violet-800 dark:from-violet-950/50 dark:to-fuchsia-950/40"
    >
      <span className="font-semibold text-violet-700 dark:text-violet-300">
        {t("text")}
      </span>
      <span className="shrink-0 text-xs font-semibold text-violet-500 dark:text-violet-400">
        {t("cta")}
      </span>
    </Link>
  );
}
