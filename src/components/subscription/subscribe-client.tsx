"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type Plan = {
  id: string;
  name: string;
  priceRmb: number;
  durationDays: number;
  features: string[];
  badge: string;
  sortOrder: number;
};

type CurrentSub = {
  planId: string;
  expiresAt: string;
  daysRemaining: number;
  autoRenew: boolean;
} | null;

type PayModalState =
  | { kind: "closed" }
  | { kind: "loading"; planId: string }
  | { kind: "qr"; planId: string; orderId: string; qr: string; payUrl: string | null }
  | { kind: "error"; message: string };

function discountPercent(planId: string): number {
  if (planId === "quarterly") return 17;
  if (planId === "yearly") return 48;
  return 0;
}

export function SubscribeClient() {
  const router = useRouter();
  const t = useTranslations("subscription");
  const tq = useTranslations("quota");
  const tcommon = useTranslations("common");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [featureKeys, setFeatureKeys] = useState<string[]>([]);
  const [current, setCurrent] = useState<CurrentSub>(null);
  const [loading, setLoading] = useState(true);
  const [payModal, setPayModal] = useState<PayModalState>({ kind: "closed" });
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const res = await fetch("/api/subscription/plans", { cache: "no-store" });
        const data = await res.json();
        if (aborted) return;
        if (data?.ok) {
          setPlans(data.plans ?? []);
          setFeatureKeys(data.featureKeys ?? []);
          setCurrent(data.current ?? null);
        }
      } catch (err) {
        console.error("subscribe: fetch plans failed", err);
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  const recommended = useMemo(() => {
    return plans.find((p) => p.id === "quarterly") ?? plans[1] ?? plans[0] ?? null;
  }, [plans]);

  const onSubscribe = async (planId: string) => {
    if (payModal.kind !== "closed") return;
    setPayModal({ kind: "loading", planId });
    try {
      const res = await fetch("/api/subscription/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setPayModal({ kind: "error", message: data?.error ?? t("payFailed") });
        return;
      }
      setPayModal({
        kind: "qr",
        planId,
        orderId: data.orderId,
        qr: data.qr,
        payUrl: data.payUrl ?? null,
      });
    } catch (err) {
      setPayModal({
        kind: "error",
        message: err instanceof Error ? err.message : t("payFailed"),
      });
    }
  };

  const onCancelAutoRenew = async () => {
    try {
      const res = await fetch("/api/subscription/cancel", { method: "POST" });
      const data = await res.json();
      if (data?.ok) {
        setCurrent((prev) => (prev ? { ...prev, autoRenew: false } : prev));
        setShowCancelConfirm(false);
      }
    } catch (err) {
      console.error("cancel auto-renew failed", err);
    }
  };

  // 简单轮询：支付完成 3 秒后尝试刷新订阅状态
  useEffect(() => {
    if (payModal.kind !== "qr") return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/subscription/status", { cache: "no-store" });
        const data = await res.json();
        if (data?.ok && data?.isVip) {
          setPayModal({ kind: "closed" });
          router.refresh();
          setCurrent({
            planId: data.planId,
            expiresAt: data.expiresAt,
            daysRemaining: data.daysRemaining,
            autoRenew: data.autoRenew,
          });
        }
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [payModal.kind, router]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-zinc-500">
        {tcommon("loading") ?? "Loading..."}
      </div>
    );
  }

  const isVip = current !== null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
      {/* Header */}
      <header className="text-center">
        <div className="mb-3 text-3xl sm:text-4xl">🐾</div>
        <h1 className="bg-gradient-to-r from-amber-500 via-orange-500 to-pink-500 bg-clip-text text-3xl font-bold text-transparent sm:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 sm:text-base">{t("subtitle")}</p>
        {isVip && current ? (
          <div className="mx-auto mt-6 max-w-md rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-left">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
              <span>💎</span>
              <span>
                {t("currentPlan")}：{current.planId}
              </span>
            </div>
            <div className="mt-1 text-xs text-amber-600">
              {t("expiresAt")}：{new Date(current.expiresAt).toLocaleDateString()} ·{" "}
              {t("daysRemaining", { days: current.daysRemaining })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowCancelConfirm(true)}
                disabled={!current.autoRenew}
                className="rounded-full border border-amber-300 bg-white px-4 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {current.autoRenew ? t("cancelAutoRenew") : t("manageSubscription")}
              </button>
            </div>
          </div>
        ) : null}
      </header>

      {/* Pricing cards */}
      <section className="mt-10 grid gap-5 sm:grid-cols-2 md:grid-cols-3">
        {plans.map((plan) => {
          const isRecommended = recommended?.id === plan.id;
          const discount = discountPercent(plan.id);
          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm transition ${
                isRecommended
                  ? "scale-[1.03] border-amber-300 ring-2 ring-amber-300/60 md:scale-105"
                  : "border-zinc-200 hover:border-zinc-300"
              }`}
            >
              {isRecommended ? (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-amber-500 to-pink-500 px-3 py-1 text-xs font-semibold text-white shadow">
                  ⭐ {t("mostPopular")}
                </span>
              ) : null}
              <h3 className="text-lg font-semibold text-zinc-900">{plan.name}</h3>
              {discount > 0 ? (
                <span className="mt-1 inline-block w-fit rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                  {t("saveBadge", { percent: discount })}
                </span>
              ) : null}
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-bold text-zinc-900">
                  ¥{(plan.priceRmb / 100).toFixed(plan.priceRmb % 100 === 0 ? 0 : 1)}
                </span>
                <span className="text-xs text-zinc-400">/ {plan.durationDays} days</span>
              </div>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-zinc-600">
                {plan.features.map((f) => {
                  const label = t.has(`features.${f}`) ? t(`features.${f}`) : f;
                  return (
                    <li key={f} className="flex items-center gap-2">
                      <span className="text-emerald-500">✓</span>
                      <span>{label}</span>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={() => onSubscribe(plan.id)}
                disabled={payModal.kind !== "closed"}
                className={`mt-6 w-full rounded-full px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
                  isRecommended
                    ? "bg-gradient-to-r from-amber-500 to-pink-500 text-white hover:opacity-90"
                    : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50"
                }`}
              >
                {payModal.kind === "loading" && payModal.planId === plan.id
                  ? t("subscribing")
                  : t("subscribe")}
              </button>
            </div>
          );
        })}
      </section>

      {/* Perks grid */}
      <section className="mt-14">
        <h2 className="text-center text-xl font-semibold text-zinc-900 sm:text-2xl">
          {t("perksTitle")}
        </h2>
        <ul className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {featureKeys.map((key) => (
            <li
              key={key}
              className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-zinc-700"
            >
              <span className="text-amber-500">✅</span>
              <span>{t.has(`features.${key}`) ? t(`features.${key}`) : key}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* FAQ */}
      <section className="mt-14 rounded-2xl border border-zinc-200 bg-white p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-zinc-900">{t("faq.title")}</h2>
        <dl className="mt-5 space-y-5 text-sm">
          {(["q1", "q2", "q3"] as const).map((k) => (
            <div key={k}>
              <dt className="font-medium text-zinc-900">{t(`faq.${k}`)}</dt>
              <dd className="mt-1 text-zinc-600">
                {t(`faq.${k.replace(/^q/, "a")}` as "a1" | "a2" | "a3")}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="mt-8 text-center text-xs text-zinc-400">{t("terms")}</p>

      <div className="mt-6 text-center">
        <Link href="/chat" className="text-sm text-zinc-500 hover:underline">
          ← {tq("comebackTomorrow")}
        </Link>
      </div>

      {renderPayModal(payModal, setPayModal, t)}
      {renderCancelModal(showCancelConfirm, setShowCancelConfirm, onCancelAutoRenew, t)}
    </div>
  );
}

function renderPayModal(
  payModal: PayModalState,
  setPayModal: (s: PayModalState) => void,
  t: ReturnType<typeof useTranslations<"subscription">>,
) {
  if (payModal.kind === "closed") return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        {payModal.kind === "loading" ? (
          <div className="py-10 text-center text-zinc-500">{t("subscribing")}</div>
        ) : payModal.kind === "qr" ? (
          <>
            <h3 className="text-lg font-semibold text-zinc-900">
              {t("subscribe")} · {payModal.planId}
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              订单号：<code className="text-[10px]">{payModal.orderId}</code>
            </p>
            <div className="mt-5 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={payModal.qr}
                alt="支付二维码"
                className="h-56 w-56 rounded-lg border border-zinc-200 object-contain"
              />
            </div>
            {payModal.payUrl ? (
              <a
                href={payModal.payUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block text-center text-xs text-zinc-500 underline"
              >
                打开支付链接
              </a>
            ) : null}
            <p className="mt-4 text-center text-xs text-zinc-400">
              支付完成后此页面将自动关闭…
            </p>
            <button
              type="button"
              onClick={() => setPayModal({ kind: "closed" })}
              className="mt-4 w-full rounded-full border border-zinc-200 bg-white py-2 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              取消
            </button>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-rose-600">{t("payFailed")}</h3>
            <p className="mt-2 text-sm text-zinc-500">{payModal.message}</p>
            <button
              type="button"
              onClick={() => setPayModal({ kind: "closed" })}
              className="mt-5 w-full rounded-full bg-zinc-900 py-2 text-sm text-white"
            >
              关闭
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function renderCancelModal(
  show: boolean,
  setShow: (b: boolean) => void,
  onConfirm: () => void,
  t: ReturnType<typeof useTranslations<"subscription">>,
) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="text-base font-semibold text-zinc-900">{t("cancelAutoRenew")}</h3>
        <p className="mt-2 text-sm text-zinc-500">{t("confirmCancel")}</p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => setShow(false)}
            className="flex-1 rounded-full border border-zinc-200 bg-white py-2 text-sm text-zinc-700"
          >
            {t("keepVip")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-full bg-rose-600 py-2 text-sm text-white"
          >
            {t("cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

