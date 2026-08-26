"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { PayQr } from "@/components/pay-qr";

type Cosmetic = {
  id: string;
  name: string;
  kind: "skin" | "effect" | string;
  imageUrl: string | null;
  priceCny: string;
  owned: boolean;
};

/**
 * 装扮商城弹窗（宠物详情页入口）：
 *  - 展示付费皮肤/特效，未购买显示 🔒 锁定状态；
 *  - 购买：POST /api/pay/create（kind=cosmetic）→ XorPay 二维码 → 轮询已购状态；
 *  - 顶部「高级公民月卡」入口：kind=premium，解锁更长上下文记忆特权。
 */
export function CosmeticsShopModal({
  open,
  adoptionId,
  onClose,
}: {
  open: boolean;
  adoptionId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("cosmetics");
  const tc = useTranslations("common");
  const [items, setItems] = useState<Cosmetic[]>([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payingPremium, setPayingPremium] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!adoptionId) return;
    try {
      const res = await fetch(`/api/cosmetics?adoptionId=${encodeURIComponent(adoptionId)}`);
      const data = await res.json();
      if (data?.ok) setItems(data.items ?? []);
    } catch {
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [adoptionId, t]);

  useEffect(() => {
    if (open && adoptionId) {
      setLoading(true);
      setError("");
      void load();
    }
  }, [open, adoptionId, load]);

  useEffect(() => () => stopPolling(), []);

  const stopPolling = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // 支付后轮询已购状态（2s，最多 90 次）
  const startPolling = () => {
    stopPolling();
    let count = 0;
    timerRef.current = setInterval(async () => {
      count += 1;
      const res = await fetch(`/api/cosmetics?adoptionId=${encodeURIComponent(adoptionId ?? "")}`);
      const data = await res.json();
      if (data?.items?.every((x: Cosmetic) => x.owned)) {
        stopPolling();
        setQr(null);
        setPayingId(null);
        setPayingPremium(false);
        void load();
      }
      if (count >= 90) stopPolling();
    }, 2000);
  };

  const buy = async (kind: "cosmetic" | "premium", cosmeticId?: string) => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    setError("");
    const body: Record<string, unknown> = { kind };
    if (kind === "cosmetic" && cosmeticId) {
      body.cosmeticId = cosmeticId;
      body.adoptionId = adoptionId;
      setPayingId(cosmeticId);
    } else {
      setPayingPremium(true);
    }
    try {
      const res = await fetch("/api/pay/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data?.ok && data.qr) {
        setQr(data.qr);
        startPolling();
      } else {
        setError(data?.error ?? t("orderFailed"));
        setPayingId(null);
        setPayingPremium(false);
      }
    } catch {
      setError(tc("networkError"));
      setPayingId(null);
      setPayingPremium(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-zinc-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-violet-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-zinc-900">🛍️ {t("title")}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
            aria-label={tc("close")}
          >
            ×
          </button>
        </div>

        {/* 高级公民月卡 */}
        <section className="mb-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-amber-700">👑 {t("premiumTitle")}</div>
              <div className="mt-0.5 text-[11px] text-amber-600">{t("premiumDesc")}</div>
            </div>
            <button
              type="button"
              disabled={payingPremium}
              onClick={() => void buy("premium")}
              className="shrink-0 rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-amber-600 disabled:opacity-60"
            >
              {payingPremium ? t("processing") : `${t("buy")} ¥1`}
            </button>
          </div>
        </section>

        {loading && <p className="py-6 text-center text-sm text-zinc-400">{t("loading")}</p>}
        {error && <p className="py-2 text-center text-sm text-red-500">{error}</p>}

        {qr ? (
          <div className="py-3 text-center">
            <div className="mb-2 text-sm text-zinc-600">{t("scanHint")}</div>
            <PayQr value={qr} size={200} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {items.map((c) => (
              <div
                key={c.id}
                className={`rounded-xl border p-3 ${
                  c.owned ? "border-violet-200 bg-violet-50/60" : "border-zinc-200 bg-white"
                }`}
              >
                <div className="flex h-16 items-center justify-center rounded-lg bg-zinc-50 text-3xl">
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.imageUrl} alt={c.name} className="h-full w-full rounded-lg object-cover" />
                  ) : (
                    c.kind === "skin" ? "🎨" : "✨"
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-zinc-800">{c.name}</span>
                  {c.owned ? (
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-600">
                      {t("owned")}
                    </span>
                  ) : (
                    <span className="text-sm">🔒</span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={c.owned || payingId === c.id}
                  onClick={() => void buy("cosmetic", c.id)}
                  className={`mt-2 w-full rounded-full py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
                    c.owned
                      ? "bg-violet-100 text-violet-500"
                      : "bg-orange-500 text-white hover:bg-orange-600"
                  }`}
                >
                  {c.owned ? t("equipped") : `${t("buy")} ¥${c.priceCny}`}
                </button>
              </div>
            ))}
            {!loading && items.length === 0 && (
              <p className="col-span-full py-6 text-center text-sm text-zinc-400">{t("empty")}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
