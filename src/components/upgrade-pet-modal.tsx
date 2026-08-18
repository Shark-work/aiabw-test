"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

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

  // Create the order automatically when the modal opens
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
        setError(data?.error ?? "Order creation failed, please try again");
      }
    } catch {
      setLoading(false);
      setError("Network error, please try again");
    }
  }, [adoptionId, loading]);

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
          alert("🎉 Unlocked! You can now adopt more companions.");
          onUnlocked?.();
          onClose();
          return;
        }
      } catch {
        // A single polling failure does not abort
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
          <h3 className="text-lg font-bold text-zinc-900">🔓 Unlock the Multi-Pet Collection</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className="mb-1 text-sm text-zinc-600">
          {petCount != null && petCount >= 1
            ? `You already have ${petCount} companion${petCount > 1 ? "s" : ""}! Unlock to adopt new friends and chat without limits.`
            : "Unlock to adopt new friends and chat without limits."}
        </p>
        <p className="mb-4 text-xs text-zinc-400">
          Sponsor a milk tea for ¥9.9 and unlock all pet slots (one-time, permanent).
        </p>

        {error ? (
          <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
            Generating payment QR code...
          </div>
        )}

        {qr ? (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <QRCodeSVG value={qr} size={200} />
            </div>
            <p className="text-xs text-zinc-500">
              Scan with WeChat / Alipay. Your account unlocks automatically after payment.
            </p>
            {payUrl ? (
              <a
                href={payUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-600"
              >
                Open payment page
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
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
