"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type Props = {
  open: boolean;
  /** 需要支付的宠物（用户的已有宠物之一），用于 /api/pay/create 下单 */
  adoptionId: string | null;
  petCount?: number;
  onClose: () => void;
  onUnlocked?: () => void;
};

/**
 * 升级解锁弹窗：单宠限制命中时引导用户付费解锁「多宠图鉴」。
 * 复用聊天页的支付流程：/api/pay/create 拿二维码 → 轮询 /api/pet/status 检测解锁。
 */
export function UpgradePetModal({
  open,
  adoptionId,
  petCount,
  onClose,
  onUnlocked,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setLoading(false);
    setQr(null);
    setPayUrl(null);
    setError("");
  }, [stopPolling]);

  // 打开时自动下单
  const createOrder = useCallback(async () => {
    if (!adoptionId || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/pay/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptionId, amount: 9.9 }),
      });
      const data = await res.json();
      if (data?.ok) {
        setLoading(false);
        setQr(data.qr);
        setPayUrl(data.payUrl ?? null);
      } else {
        setLoading(false);
        setError(data?.error ?? "下单失败，请稍后重试");
      }
    } catch {
      setLoading(false);
      setError("网络错误，请稍后重试");
    }
  }, [adoptionId, loading]);

  useEffect(() => {
    if (open) {
      reset();
      // 让 DOM 先渲染，再发起下单
      const t = setTimeout(() => void createOrder(), 50);
      return () => clearTimeout(t);
    }
    reset();
  }, [open, createOrder, reset]);

  // 二维码就绪后轮询解锁状态（每 2s，最多 90 次）
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
          alert("🎉 解锁成功！现在可以领养更多宠物啦~");
          onUnlocked?.();
          onClose();
          return;
        }
      } catch {
        // 单次失败不中断
      }
      if (count >= 90) stopPolling();
    }, 2000);
    return stopPolling;
  }, [open, qr, adoptionId, onUnlocked, onClose, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-zinc-900">🔓 解锁「多宠图鉴」</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <p className="mb-1 text-sm text-zinc-600">
          {petCount != null && petCount >= 1
            ? `你已经有了 ${petCount} 只艾比伙伴啦！解锁后可再领养新伙伴，还能无限畅聊~`
            : "解锁后可再领养新伙伴，还能无限畅聊~"}
        </p>
        <p className="mb-4 text-xs text-zinc-400">
          赞助一杯奶茶 ¥9.9，解锁全部宠物位置（1 次解锁长期有效）
        </p>

        {error ? (
          <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
            正在生成支付二维码...
          </div>
        )}

        {qr ? (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <QRCodeSVG value={qr} size={200} />
            </div>
            <p className="text-xs text-zinc-500">
              请使用微信 / 支付宝扫码支付，支付成功后自动解锁
            </p>
            {payUrl ? (
              <a
                href={payUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-600"
              >
                点击前往收银台支付
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-zinc-100 px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-200"
          >
            暂不解锁
          </button>
        </div>
      </div>
    </div>
  );
}
