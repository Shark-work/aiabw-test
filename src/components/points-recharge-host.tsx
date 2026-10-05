"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "next-intl";

import { usePathname } from "@/i18n/navigation";
import { FirstPurchaseModal } from "@/components/first-purchase-modal";
import { PointsInsufficientModal } from "@/components/points-insufficient-modal";
import {
  POINTS_INSUFFICIENT_EVENT,
  type PointsInsufficientDetail,
} from "@/lib/points-entry";

type Props = {
  /** 充值到账后回写 header 积分余额（PointsBalance 实时更新） */
  onPointsChanged: (points: number) => void;
};

type Session = {
  needed?: number;
  isFirstPurchase: boolean;
  baselinePoints: number;
};

/**
 * 全局「积分不足」充值引导宿主（产品升级 Phase 4，挂在 SiteHeader）：
 * 监听 points-entry 事件总线 → 拉余额基线 + 首充状态 →
 * 未首充 → FirstPurchaseModal（双倍特惠）；已首充 → PointsInsufficientModal（常规引导）。
 * 未登录 → 跳登录页（redirect 回当前页）。状态拉取失败时保守按「已首充」处理（不误标双倍）。
 */
export function PointsRechargeHost({ onPointsChanged }: Props) {
  const locale = useLocale();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PointsInsufficientDetail>).detail ?? {};
      const token = localStorage.getItem("aiabw_token");
      if (!token) {
        window.location.href = `/${locale}/login?redirect=${encodeURIComponent(pathname ?? "/")}`;
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };
      void (async () => {
        let baselinePoints = 0;
        let isFirstPurchase = false;
        try {
          const meRes = await fetch("/api/auth/me", { headers });
          const me = await meRes.json();
          if (me?.ok && me.user) baselinePoints = me.user.points ?? 0;
        } catch {
          // 基线 0 兜底：到账判定仍可用（余额 ≥ 0 + 档位积分）
        }
        try {
          const stRes = await fetch("/api/user/first-purchase/status", { headers });
          const st = await stRes.json();
          if (st?.ok) isFirstPurchase = !!st.isFirstPurchase;
        } catch {
          // 保守：状态未知时不出双倍标签（避免误导承诺）
        }
        setSession({ needed: detail.needed, isFirstPurchase, baselinePoints });
      })();
    };
    window.addEventListener(POINTS_INSUFFICIENT_EVENT, handler);
    return () => window.removeEventListener(POINTS_INSUFFICIENT_EVENT, handler);
  }, [locale, pathname]);

  const close = useCallback(() => setSession(null), []);
  const handleCredited = useCallback(
    (after: number) => {
      onPointsChanged(after);
      setSession(null);
    },
    [onPointsChanged],
  );

  if (!session) return null;

  return session.isFirstPurchase ? (
    <FirstPurchaseModal
      open
      needed={session.needed}
      baselinePoints={session.baselinePoints}
      onClose={close}
      onCredited={handleCredited}
    />
  ) : (
    <PointsInsufficientModal
      open
      needed={session.needed}
      isFirstPurchase={false}
      baselinePoints={session.baselinePoints}
      onClose={close}
      onCredited={handleCredited}
    />
  );
}
