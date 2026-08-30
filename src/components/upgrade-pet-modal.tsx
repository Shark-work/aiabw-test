"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PaymentModal } from "@/components/payment-modal";

type Props = {
  open: boolean;
  /** The pet (one of the user's existing pets) to pay for; used by /api/pay/create */
  adoptionId: string | null;
  petCount?: number;
  onClose: () => void;
  onUnlocked?: () => void;
};

/**
 * Upgrade / unlock modal: shown when the single-pet rule blocks the user.
 * Same payment flow as the chat page: /api/pay/create → QR → poll /api/pet/status.
 */
export function UpgradePetModal({
  open,
  adoptionId,
  petCount,
  onClose,
  onUnlocked,
}: Props) {
  const t = useTranslations("pay");
  const tc = useTranslations("common");
  const [loading, setLoading] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 防重入：loading 一旦作为 useCallback 依赖，会在 setLoading(true) 后重建函数引用，
  // 进而让下面的 useEffect([open, createOrder, ...]) 反复触发 → 弹窗/二维码闪动 + 重复建单。
  const creatingRef = useRef(false);
  // 父组件每次渲染都会重建内联的 onClose/onUnlocked；若直接放进依赖，
  // 轮询 effect 会反复重启（clearInterval+重开），甚至打断扫码后的解锁判定。
  // 用 ref 保存最新引用，effect 只依赖稳定值。
  const onUnlockedRef = useRef(onUnlocked);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onUnlockedRef.current = onUnlocked;
  }, [onUnlocked]);
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

  // Create the order automatically when the modal opens
  const createOrder = useCallback(async () => {
    if (!adoptionId || creatingRef.current) return;
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
        body: JSON.stringify({ adoptionId, amount: 9.9 }),
      });
      const data = await res.json();
      if (data?.ok) {
        setQr(data.qr);
        setPayUrl(data.payUrl ?? null);
      } else {
        setError(data?.error ?? t("orderFailed"));
      }
    } catch {
      setError(tc("networkError"));
    } finally {
      creatingRef.current = false;
      setLoading(false);
    }
  }, [adoptionId, t, tc]);

  useEffect(() => {
    if (open) {
      reset();
      // Let the DOM render first, then create the order
      const t = setTimeout(() => void createOrder(), 50);
      return () => clearTimeout(t);
    }
    reset();
  }, [open, createOrder, reset]);

  // Once the QR is ready, poll the unlock status (every 2s, max 90 times)
  useEffect(() => {
    if (!open || !qr || !adoptionId) return;
    stopPolling();
    let count = 0;
    timerRef.current = setInterval(async () => {
      count += 1;
      try {
        const res = await fetch(`/api/pet/status?id=${adoptionId}`);
        const data = await res.json();
        if (data?.ok && data.isUnlocked) {
          stopPolling();
          alert(t("unlockedOk"));
          onUnlockedRef.current?.();
          onCloseRef.current?.();
          return;
        }
      } catch {
        // A single polling failure does not abort
      }
      if (count >= 90) stopPolling();
    }, 2000);
    return stopPolling;
  }, [open, qr, adoptionId, stopPolling, t]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  if (!open) return null;

  return (
    <PaymentModal
      open={open}
      title={t("title")}
      amount={9.9}
      description={petCount != null && petCount >= 1 ? t("descCount", { count: petCount }) : t("desc")}
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
