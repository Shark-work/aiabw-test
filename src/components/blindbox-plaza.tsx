"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { PetAvatar } from "@/components/PetAvatar";
import { PayQr } from "@/components/pay-qr";
import { getRarityMeta } from "@/lib/pet-status";

type BlindboxPool = {
  id: string;
  name: string;
  priceCny: string;
  pricePoints: number;
  probabilities: Record<string, number>;
};

type DrawResult = {
  ok: boolean;
  isLegendary?: boolean;
  rarity?: string;
  poolId?: string;
  nfr?: {
    speciesName: string;
    rarity: string;
    element: string;
    generation: number;
    imageUrl: string;
    hashId: string;
  };
  error?: string;
};

/** 爆率 → 中文标签（公示用）。 */
const RARITY_ZH: Record<string, string> = {
  common: "普通",
  uncommon: "精良",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
};

type PayState = {
  orderId: string;
  qr?: string;
  payUrl?: string | null;
  amount: number;
};

/**
 * 单个盲盒卡（状态隔离重构）：
 *  - drawing / opening / result / pay 全部为卡内独立 useState，
 *    点击 A 盲盒不会禁用/影响 B 盲盒的按钮；
 *  - 抽奖流程：余额预检 → 积分足够走积分通道；
 *    积分不足走现金兜底（创建 XorPay 订单 → 扫码支付 → 轮询结果自动开箱）。
 */
function BlindBoxCard({ pool }: { pool: BlindboxPool }) {
  const t = useTranslations("blindbox");
  const tc = useTranslations("common");
  const [drawing, setDrawing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState<DrawResult | null>(null);
  const [showOdds, setShowOdds] = useState(false);
  const [pay, setPay] = useState<PayState | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  useEffect(() => () => stopPolling(), [stopPolling]);

  const startOpen = (data: DrawResult) => {
    setPay(null);
    setOpening(true);
    setTimeout(() => {
      setOpening(false);
      setResult(data);
    }, 3000);
  };

  /** 现金支付确认轮询（每 2s，最多 90 次）：notify 回调抽取完成后自动开箱。 */
  const startPolling = (orderId: string) => {
    stopPolling();
    let count = 0;
    timerRef.current = setInterval(async () => {
      count += 1;
      try {
        const token = localStorage.getItem("aiabw_token");
        if (!token) {
          stopPolling();
          return;
        }
        const res = await fetch("/api/blindbox/draw", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ poolId: pool.id, paymentMethod: "cash", orderId }),
        });
        const data = await res.json();
        if (data?.ok && !data.needPayment) {
          stopPolling();
          startOpen(data);
          return;
        }
      } catch {
        // 单次轮询失败不中断
      }
      if (count >= 90) stopPolling();
    }, 2000);
  };

  const draw = async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) {
      setResult({ ok: false, error: t("needLogin") });
      return;
    }
    setDrawing(true);
    setResult(null);
    setPay(null);
    try {
      // 1) 余额预检：积分足够 → 积分通道；不足 → 现金兜底
      let method: "points" | "cash" = "points";
      try {
        const me = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json());
        if (me?.user && Number(me.user.points ?? 0) < pool.pricePoints) method = "cash";
      } catch {
        // 余额查询失败：走积分通道，由后端 402 兜底提示
      }

      // 2) 调开箱接口（携带支付方式）
      const res = await fetch("/api/blindbox/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ poolId: pool.id, paymentMethod: method }),
      });
      const data = await res.json();

      if (data?.ok) {
        if (data.needPayment) {
          // 积分不足 → 现金兜底：展示支付二维码 + 轮询确认
          setPay({
            orderId: data.orderId,
            qr: data.qr,
            payUrl: data.payUrl ?? null,
            amount: data.amount ?? 0,
          });
          startPolling(data.orderId);
        } else {
          startOpen(data);
        }
      } else {
        setResult({ ok: false, error: data?.error ?? t("drawFailed") });
      }
    } catch {
      setResult({ ok: false, error: t("drawFailed") });
    } finally {
      setDrawing(false);
    }
  };

  const shareToX = () => {
    if (!result?.nfr) return;
    const text = `🎉 我在 #艾比世界 抽盲盒开出${result.isLegendary ? "传说" : ""}级「${result.nfr.speciesName}」！${result.nfr.hashId.slice(0, 8)} #盲盒`;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const rarityMeta = result?.nfr ? getRarityMeta(String(result.nfr.rarity ?? "common")) : null;
  const isNewbie = pool.id === "newbie_welcome";
  const isHot = pool.id === "cyber_myth";

  return (
    <>
      <div
        className={`rounded-xl border p-4 ${
          isHot
            ? "border-amber-400 bg-gradient-to-br from-violet-50 via-fuchsia-50 to-amber-50 shadow-lg ring-1 ring-amber-200"
            : isNewbie
              ? "border-red-200 bg-gradient-to-br from-red-50 to-orange-50"
              : "border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50"
        }`}
      >
        <div className="text-3xl">📦</div>
        {(isNewbie || isHot) && (
          <span
            className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold text-white shadow ${
              isNewbie
                ? "bg-gradient-to-r from-red-500 to-orange-500"
                : "bg-gradient-to-r from-violet-500 to-fuchsia-500"
            }`}
          >
            {isNewbie ? t("newbieTag") : t("hotTag")}
          </span>
        )}
        <div className="mt-1 text-base font-bold text-zinc-900">{pool.name}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
          <span className="rounded-full bg-orange-100 px-2 py-0.5 font-semibold text-orange-700">
            {pool.pricePoints} {t("points")}
          </span>
          <span className="text-zinc-400">/ ¥{pool.priceCny}</span>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={drawing}
            onClick={() => void draw()}
            className="flex-1 rounded-full bg-orange-500 px-3 py-2.5 text-sm font-bold text-white shadow-md shadow-orange-200 transition hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-lg active:scale-95 disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {drawing ? t("drawing") : t("draw")}
          </button>
          <button
            type="button"
            onClick={() => setShowOdds(true)}
            className="rounded-full bg-white px-3 py-2 text-xs font-medium text-zinc-500 shadow-sm transition hover:text-orange-600"
            title={t("oddsHint")}
          >
            📊 {t("odds")}
          </button>
        </div>
      </div>

      {/* 爆率公示弹窗（合规） */}
      {showOdds && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-900/60 p-4 backdrop-blur-sm"
          onClick={() => setShowOdds(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-orange-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-base font-bold text-zinc-900">
              📊 {pool.name} · {t("odds")}
            </h4>
            <ul className="mt-3 space-y-2">
              {Object.entries(pool.probabilities)
                .sort((a, b) => Number(b[1]) - Number(a[1]))
                .map(([rarity, p]) => (
                  <li key={rarity} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-600">
                      {getRarityMeta(rarity).emoji} {RARITY_ZH[rarity] ?? rarity}
                    </span>
                    <span className="font-semibold text-orange-600">{p}%</span>
                  </li>
                ))}
            </ul>
            <button
              type="button"
              onClick={() => setShowOdds(false)}
              className="mt-4 w-full rounded-full bg-zinc-100 py-2 text-sm text-zinc-600 transition hover:bg-zinc-200"
            >
              {tc("close")}
            </button>
          </div>
        </div>
      )}

      {/* 现金支付弹窗（积分不足兜底）：扫码支付 → 到账后自动开箱 */}
      {pay && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-zinc-900/70 p-4 backdrop-blur"
          onClick={() => setPay(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border-2 border-orange-300 bg-white p-5 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-2xl">💳</div>
            <h4 className="mt-1 text-lg font-bold text-zinc-900">
              {t("payNeed", { price: pay.amount.toFixed(2) })}
            </h4>
            {pay.qr ? (
              <>
                <PayQr value={pay.qr} size={180} />
                <p className="text-xs text-zinc-400">{t("payQrHint")}</p>
                {pay.payUrl && (
                  <a
                    href={pay.payUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-orange-600"
                  >
                    {t("payOpenCashier")}
                  </a>
                )}
              </>
            ) : (
              <p className="py-6 text-sm text-zinc-500">{t("payWaiting")}</p>
            )}
            <button
              type="button"
              onClick={() => setPay(null)}
              className="mt-3 w-full rounded-full bg-zinc-100 py-2 text-sm text-zinc-600 transition hover:bg-zinc-200"
            >
              {t("payCancel")}
            </button>
          </div>
        </div>
      )}

      {/* 开箱动画（约 3s 发光震动） */}
      {opening && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-zinc-900/80 backdrop-blur">
          <div className="bx-box text-center">
            <div className="text-7xl animate-pulse">📦</div>
            <p className="mt-3 text-lg font-bold text-orange-300">{t("opening")}</p>
          </div>
        </div>
      )}

      {/* 结果弹窗（传说：撒花 + 分享按钮） */}
      {result && !opening && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-zinc-900/70 p-4 backdrop-blur"
          onClick={() => setResult(null)}
        >
          {result.isLegendary && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {["🎉", "✨", "🌟", "🎊", "💫", "⭐"].map((e, i) => (
                <span
                  key={i}
                  className="bx-confetti"
                  style={{ left: `${8 + i * 15}%`, animationDelay: `${i * 0.25}s` }}
                >
                  {e}
                </span>
              ))}
            </div>
          )}
          <div
            className="w-full max-w-sm rounded-2xl border-2 border-orange-300 bg-white p-5 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-2xl">{result.isLegendary ? "🌟" : "🎉"}</div>
            <div
              className={`mt-1 text-lg font-bold ${
                result.isLegendary ? "text-amber-500" : "text-orange-600"
              }`}
            >
              {result.isLegendary ? t("legendaryTitle") : t("normalTitle")}
            </div>
            {result.nfr ? (
              <>
                <div className="mt-3 flex items-center justify-center gap-3">
                  <PetAvatar
                    src={result.nfr.imageUrl}
                    alt={result.nfr.speciesName}
                    className="h-20 w-20 rounded-2xl border-2 border-orange-200 bg-orange-50 object-cover"
                  />
                  <div className="text-left">
                    <div className="text-base font-bold text-zinc-800">{result.nfr.speciesName}</div>
                    <div className="mt-0.5 flex items-center gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${rarityMeta?.badgeClass}`}>
                        {rarityMeta?.emoji} {result.nfr.rarity}
                      </span>
                      <span className="rounded-full bg-zinc-50 px-2 py-0.5 text-[10px] text-zinc-500">
                        ⚡{result.nfr.element}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-zinc-300">
                      #{result.nfr.hashId.slice(0, 10)}
                    </div>
                  </div>
                </div>
                {result.isLegendary && (
                  <button
                    type="button"
                    onClick={shareToX}
                    className="mt-4 w-full rounded-full bg-sky-500 px-4 py-2.5 text-sm font-bold text-white shadow transition hover:bg-sky-600"
                  >
                    🐦 {t("shareX")}
                  </button>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-red-500">{result.error}</p>
            )}
            <button
              type="button"
              onClick={() => setResult(null)}
              className="mt-3 w-full rounded-full bg-zinc-100 py-2 text-sm text-zinc-600 transition hover:bg-zinc-200"
            >
              {tc("close")}
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .bx-box {
          animation: bxShake 0.6s ease-in-out infinite;
        }
        @keyframes bxShake {
          0%, 100% { transform: scale(1) translateX(0); }
          25% { transform: scale(1.06) translateX(-4px); }
          50% { transform: scale(1) translateX(4px); }
          75% { transform: scale(1.06) translateX(-2px); }
        }
        .bx-confetti {
          position: absolute;
          top: -40px;
          font-size: 28px;
          animation: bxFall 3.5s ease-in infinite;
        }
        @keyframes bxFall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(360deg); opacity: 0.2; }
        }
      `}</style>
    </>
  );
}

/** 盲盒广场容器：加载奖池并渲染独立 <BlindBoxCard />（状态隔离，互不干扰）。 */
export function BlindboxPlaza() {
  const t = useTranslations("blindbox");
  const ts = useTranslations("seo");
  const [pools, setPools] = useState<BlindboxPool[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/blindbox");
      const data = await res.json();
      if (data?.ok) {
        const list = data.pools ?? [];
        // 运营排序：新手福利箱置顶（首抽钩子），赛博神话箱次之，其余按服务端顺序
        const rank: Record<string, number> = { newbie_welcome: 0, cyber_myth: 1 };
        setPools([...list].sort((a, b) => (rank[a.id] ?? 9) - (rank[b.id] ?? 9)));
      }
    } catch {
      /* 静默 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="w-full rounded-2xl border border-orange-200 bg-white/90 p-4 shadow-sm backdrop-blur">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-zinc-800">🎁 {t("title")}</h3>
        <Link
          href="/blindbox"
          className="shrink-0 text-[11px] font-medium text-orange-500 transition hover:text-orange-600"
        >
          {ts("viewAll")} →
        </Link>
      </div>

      {loading && <p className="py-6 text-center text-sm text-zinc-400">{t("loading")}</p>}
      {!loading && pools.length === 0 && (
        <p className="py-6 text-center text-sm text-zinc-400">{t("empty")}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {pools.map((p) => (
          <BlindBoxCard key={p.id} pool={p} />
        ))}
      </div>
    </section>
  );
}