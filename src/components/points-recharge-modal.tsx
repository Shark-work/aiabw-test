"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { PaymentModal } from "@/components/payment-modal";
import type { PointsPack } from "@/lib/points-recharge";

type Props = {
  open: boolean;
  /** 选中的充值档位（价格仅作展示，真实价格由服务端档位表裁定） */
  pack: PointsPack | null;
  /** 打开弹窗时的积分余额基线：轮询到账判定用（余额 ≥ 基线 + 档位积分即视为到账） */
  baselinePoints: number;
  onClose: () => void;
  onCredited?: (pointsAfter: number) => void;
};

/**
 * 积分充值弹窗（XorPay 码支付）：
 * 与多宠解锁同链路 —— /api/pay/create(kind=points) → 微信扫码 →
 * 轮询 /api/auth/me 余额（pay/notify 异步入账后余额上升即判定到账）。
 */
export function PointsRechargeModal({
  open,
  pack,
  baselinePoints,
  onClose,
  onCredited,
}: Props) {
  const t = useTranslations("points");
  const tc = useTranslations("common");
  const [loading, setLoading] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 防重入：loading 若作为 useCallback 依赖会重建函数引用 → 弹窗闪动 + 重复建单
  const creatingRef = useRef(false);
  // 父组件每次渲染都会重建内联回调；用 ref 保存最新引用，轮询 effect 只依赖稳定值
  const onCreditedRef = useRef(onCredited);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCreditedRef.current = onCredited;
  }, [onCredited]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    creatingRef.current = false;
    setLoading(false);
    setQr(null);
    setPayUrl(null);
    setError("");
  }, [stopPolling]);

  // 弹窗打开即自动下单（与 UpgradePetModal 同模式）
  const createOrder = useCallback(async () => {
    if (!pack || creatingRef.current) return;
    creatingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const token = localStorage.getItem("aiabw_token");
      const res = await fetch("/api/pay/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ kind: "points", points: pack.points }),
      });
      const data = await res.json();
      if (data?.ok) {
        setQr(data.qr);
        setPayUrl(data.payUrl ?? null);
      } else {
        setError(data?.error ?? t("rechargeFail"));
      }
    } catch {
      setError(tc("networkError"));
    } finally {
      creatingRef.current = false;
      setLoading(false);
    }
  }, [pack, t, tc]);

  useEffect(() => {
    if (open) {
      reset();
      // 让 DOM 先渲染，再创建订单
      const t = setTimeout(() => void createOrder(), 50);
      return () => clearTimeout(t);
    }
    reset();
  }, [open, createOrder, reset]);

  // 二维码就绪后轮询余额（每 2s，最多 90 次 = 3 分钟）：notify 入账 → 余额上升 → 判定到账
  useEffect(() => {
    if (!open || !qr || !pack) return;
    stopPolling();
    let count = 0;
    timerRef.current = setInterval(async () => {
      count += 1;
      try {
        const token = localStorage.getItem("aiabw_token");
        const res = await fetch("/api/auth/me", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        const now = data?.user?.points;
        if (data?.ok && typeof now === "number" && now >= baselinePoints + pack.points) {
          stopPolling();
          alert(t("rechargeOk"));
          onCreditedRef.current?.(now);
          onCloseRef.current?.();
          return;
        }
      } catch {
        // 单次轮询失败不中断
      }
      if (count >= 90) stopPolling();
    }, 2000);
    return stopPolling;
  }, [open, qr, pack, baselinePoints, stopPolling, t]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  if (!open || !pack) return null;

  return (
    <PaymentModal
      open={open}
      title={t("rechargeTitle")}
      amount={pack.priceCny}
      description={t("rechargeDesc", { points: pack.points })}
      qr={qr ?? undefined}
      payUrl={payUrl}
      pending={!!qr}
      busy={loading}
      error={error || undefined}
      onPay={(m) => {
        if (m === "wechat") void createOrder();
      }}
      onClose={onClose}
    />
  );
}
