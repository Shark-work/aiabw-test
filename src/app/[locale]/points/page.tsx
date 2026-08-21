"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { PetAvatar } from "@/components/PetAvatar";

type Log = { id: string; amount: number; reason: string; createdAt: string };

export default function PointsPage() {
  const locale = useLocale();
  const t = useTranslations("points");
  const tc = useTranslations("common");
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // 积分兑换盲盒（心理学激励）
  const [points, setPoints] = useState(0);
  const [redeeming, setRedeeming] = useState(false);
  const [redeemResult, setRedeemResult] = useState<{ id: string; speciesName: string; imageUrl: string; traits: { rarity?: string } } | null>(null);
  const [redeemMsg, setRedeemMsg] = useState("");

  const REDEEM_PRICE = 500;

  // 拉取当前积分（兑换进度条）
  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d.user) setPoints(d.user.points ?? 0);
      })
      .catch(() => {});
  }, []);

  const handleRedeem = async () => {
    if (redeeming) return;
    const token = localStorage.getItem("aiabw_token");
    if (!token) {
      window.location.href = `/${locale}/login?redirect=/points`;
      return;
    }
    setRedeeming(true);
    setRedeemMsg("");
    setRedeemResult(null);
    try {
      const res = await fetch("/api/points/redeem-pet", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.ok) {
        setPoints(data.points ?? 0);
        setRedeemResult(data.pet);
        setRedeemMsg(t("redeemOk"));
        void load();
      } else {
        setRedeemMsg(data?.error ?? t("redeemFail"));
      }
    } catch {
      setRedeemMsg(t("redeemFail"));
    } finally {
      setRedeeming(false);
    }
  };

  const reasonLabel = (r: string) => {
    const map: Record<string, string> = {
      checkin: t("checkin"),
      gacha: t("gacha"),
      ugc_buy: t("ugcBuy"),
      invite_reward: t("inviteReward"),
    };
    return map[r] ?? r;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = localStorage.getItem("aiabw_token");
      if (!token) return;
      const res = await fetch("/api/points-log", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.ok) setLogs(data.logs ?? []);
      else setError(data?.error ?? tc("loadFailed"));
    } catch {
      setError(tc("networkError"));
    } finally {
      setLoading(false);
    }
  }, [tc]);

  useEffect(() => {
    load();
  }, [load]);

  const total = logs.reduce((s, l) => s + l.amount, 0);

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 sm:p-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">{t("title")}</h1>
            <p className="text-xs text-zinc-500">
              {t("subtitle", { total: `${total > 0 ? "+" : ""}${total}` })}
            </p>
          </div>
          <Link
            href="/my-pets"
            className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
          >
            {tc("back")}
          </Link>
        </div>

        {/* 积分兑换盲盒（心理学激励：目标渐进 + 稀缺） */}
        <div className="mb-5 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-violet-900">{t("redeemTitle")}</p>
              <p className="mt-0.5 text-xs text-violet-600">{t("redeemSub")}</p>
            </div>
            <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
              {t("redeemDailyLimit")}
            </span>
          </div>

          {/* 进度条：越接近目标越兴奋 */}
          <div className="mt-3">
            <div className="flex justify-between text-[11px] text-zinc-500">
              <span>
                {t("redeemPrice")}: {REDEEM_PRICE} ⭐
              </span>
              <span>
                {points} / {REDEEM_PRICE} ⭐
              </span>
            </div>
            <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-500 transition-all duration-500"
                style={{ width: `${Math.min(100, (points / REDEEM_PRICE) * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] font-medium text-violet-700">
              {points >= REDEEM_PRICE
                ? t("redeemProgressReady")
                : t("redeemProgress", { need: REDEEM_PRICE - points })}
            </p>
          </div>

          {/* 兑换反馈 */}
          {redeemMsg && (
            <p
              className={`mt-2 text-xs font-medium ${
                redeemResult ? "text-emerald-700" : "text-red-600"
              }`}
            >
              {redeemMsg}
            </p>
          )}
          {redeemResult && (
            <div className="mt-2 flex items-center gap-3 rounded-xl bg-white/80 p-2">
              <PetAvatar
                src={redeemResult.imageUrl}
                alt={redeemResult.speciesName}
                className="h-10 w-10 rounded-full border border-violet-200 object-cover"
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-zinc-800">{redeemResult.speciesName}</p>
                <p className="truncate font-mono text-[10px] text-zinc-400">{redeemResult.id}</p>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleRedeem()}
            disabled={redeeming || points < REDEEM_PRICE}
            className="mt-3 w-full rounded-full bg-violet-500 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:opacity-40"
          >
            {redeeming ? t("redeeming") : t("redeemBtn")}
          </button>
        </div>

        {loading && <p className="py-10 text-center text-sm text-zinc-400">{tc("loading")}</p>}
        {error && <p className="py-10 text-center text-sm text-red-600">{error}</p>}
        {!loading && !error && logs.length === 0 && (
          <p className="py-10 text-center text-sm text-zinc-400">{t("empty")}</p>
        )}

        <div className="space-y-2">
          {logs.map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between rounded-xl border border-zinc-100 bg-white/90 px-4 py-2.5 shadow-sm"
            >
              <div>
                <div className="text-sm font-medium text-zinc-700">
                  {reasonLabel(l.reason)}
                </div>
                <div className="text-xs text-zinc-400">
                  {new Date(l.createdAt).toLocaleString(locale)}
                </div>
              </div>
              <span
                className={`font-semibold ${
                  l.amount >= 0 ? "text-emerald-600" : "text-red-500"
                }`}
              >
                {l.amount >= 0 ? "+" : ""}
                {l.amount}
              </span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

