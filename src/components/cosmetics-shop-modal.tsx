"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { PaymentModal } from "@/components/payment-modal";
import { LimitedOfferBanner } from "@/components/limited-offer-banner";

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
 *
 * Phase 7 · 7.6 增强：
 *  - 7.6-1 限时特惠横幅（LimitedOfferBanner，复用首充/充值事件总线）；
 *  - 7.6-2 宠物穿戴预览（点击装扮卡 → 宠物立绘 + 装扮叠加预览区）；
 *  - 7.6-3 我的收藏 tab（全部 / 已拥有过滤）；
 *  - 7.6-4 推荐搭配（最低价皮肤 × 最低价特效组合，点击定位高亮）；
 *  - 7.6-5 获取方式说明（购买 / 签到盲盒 / 首充双倍，真实口径不虚构）。
 */
export function CosmeticsShopModal({
  open,
  adoptionId,
  petImageUrl,
  onClose,
}: {
  open: boolean;
  adoptionId: string | null;
  /** 7.6-2 穿戴预览：当前宠物立绘（无则占位 emoji） */
  petImageUrl?: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("cosmetics");
  const tc = useTranslations("common");
  const [items, setItems] = useState<Cosmetic[]>([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payingPremium, setPayingPremium] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [error, setError] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 7.6-3 我的收藏 tab；7.6-2 穿戴预览选中 id；7.6-4 推荐高亮 id
  const [tab, setTab] = useState<"all" | "owned">("all");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [recommendFlashId, setRecommendFlashId] = useState<string | null>(null);

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

  // ── Phase 7 派生数据 ──
  const ownedCount = useMemo(() => items.filter((c) => c.owned).length, [items]);
  /** 7.6-3 当前 tab 过滤后的商品列表 */
  const visibleItems = useMemo(
    () => (tab === "owned" ? items.filter((c) => c.owned) : items),
    [items, tab],
  );
  /** 7.6-2 穿戴预览选中项 */
  const previewItem = useMemo(
    () => items.find((c) => c.id === previewId) ?? null,
    [items, previewId],
  );
  /** 7.6-4 推荐搭配：最低价皮肤 × 最低价特效（规则型，真实商品组合） */
  const recommendPair = useMemo(() => {
    const cheapest = (kind: string) =>
      items
        .filter((c) => c.kind === kind)
        .sort((a, b) => Number(a.priceCny) - Number(b.priceCny))[0] ?? null;
    const skin = cheapest("skin");
    const effect = cheapest("effect");
    return skin && effect ? { skin, effect } : null;
  }, [items]);

  /** 7.6-4 点击推荐搭配：预览皮肤 + 高亮特效（1.6s 后取消高亮） */
  function applyRecommend() {
    if (!recommendPair) return;
    setTab("all");
    setPreviewId(recommendPair.skin.id);
    setRecommendFlashId(recommendPair.effect.id);
    setTimeout(() => setRecommendFlashId(null), 1600);
  }

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
      setPayAmount(Number(items.find((c) => c.id === cosmeticId)?.priceCny ?? 1));
    } else {
      setPayingPremium(true);
      setPayAmount(1);
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

        {/* 7.6-1 限时特惠横幅（首充/充值事件总线，qr 支付中隐藏） */}
        {!qr && <LimitedOfferBanner className="mb-3" />}

        {/* 7.6-2 宠物穿戴预览区（点击装扮卡触发；宠物立绘 + 装扮叠加） */}
        {!qr && previewItem ? (
          <section className="mb-3 flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50/60 p-3">
            <div className="relative h-16 w-16 shrink-0">
              {petImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={petImageUrl}
                  alt=""
                  className="h-16 w-16 rounded-full border-2 border-orange-200 bg-white object-cover"
                />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-orange-200 bg-white text-2xl">
                  🐾
                </span>
              )}
              <span className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-violet-300 bg-white text-base shadow">
                {previewItem.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewItem.imageUrl} alt={previewItem.name} className="h-full w-full object-cover" />
                ) : (
                  (previewItem.kind === "skin" ? "🎨" : "✨")
                )}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-zinc-800">
                {t("previewTitle", { name: previewItem.name })}
              </div>
              <div className="mt-0.5 text-[11px] text-zinc-500">
                {previewItem.owned ? t("previewOwned") : t("previewLocked", { price: previewItem.priceCny })}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPreviewId(null)}
              className="shrink-0 text-zinc-300 transition hover:text-zinc-500"
              aria-label={tc("close")}
            >
              ×
            </button>
          </section>
        ) : null}

        {/* 7.6-4 推荐搭配条（最低价皮肤×特效真实组合；一键定位高亮） */}
        {!qr && recommendPair ? (
          <button
            type="button"
            onClick={applyRecommend}
            className="mb-3 flex w-full items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2 text-left transition hover:border-violet-300"
          >
            <span className="min-w-0 truncate text-xs text-violet-700">
              💡 {t("recommendTip", { skin: recommendPair.skin.name, effect: recommendPair.effect.name })}
            </span>
            <span className="shrink-0 text-[11px] font-semibold text-violet-500">
              {t("recommendGo")} →
            </span>
          </button>
        ) : null}

        {/* 7.6-3 我的收藏 tab（全部 / 已拥有） */}
        {!qr && items.length > 0 ? (
          <div className="mb-3 flex gap-2" role="tablist">
            {(["all", "owned"] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                  tab === id
                    ? "bg-violet-500 text-white shadow-sm"
                    : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                }`}
              >
                {id === "all" ? t("tabAll", { count: items.length }) : t("tabOwned", { count: ownedCount })}
              </button>
            ))}
          </div>
        ) : null}

        {loading && <p className="py-6 text-center text-sm text-zinc-400">{t("loading")}</p>}
        {error && <p className="py-2 text-center text-sm text-red-500">{error}</p>}

        {!qr && (
          <div className="grid grid-cols-2 gap-3">
            {visibleItems.map((c) => (
              <div
                key={c.id}
                onClick={() => setPreviewId(c.id)}
                className={`cursor-pointer rounded-xl border p-3 transition ${
                  c.owned ? "border-violet-200 bg-violet-50/60" : "border-zinc-200 bg-white"
                } ${previewId === c.id ? "ring-2 ring-orange-400" : ""} ${
                  recommendFlashId === c.id ? "animate-pulse ring-2 ring-violet-500" : ""
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
                  onClick={(e) => {
                    e.stopPropagation();
                    void buy("cosmetic", c.id);
                  }}
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
            {!loading && visibleItems.length === 0 && (
              <p className="col-span-full py-6 text-center text-sm text-zinc-400">
                {tab === "owned" ? t("ownedEmpty") : t("empty")}
              </p>
            )}
          </div>
        )}

        {/* 7.6-5 装扮获取方式说明（真实口径：购买 / 签到盲盒 / 首充双倍积分） */}
        {!qr && (
          <p className="mt-3 space-y-0.5 text-[11px] leading-relaxed text-zinc-400">
            <span className="block">💳 {t("howtoBuy")}</span>
            <span className="block">🎁 {t("howtoBlindbox")}</span>
            <span className="block">⚡ {t("howtoFirst")}</span>
          </p>
        )}

        {/* 统一支付弹窗（金额 / 扫码 / 取消） */}
        <PaymentModal
          open={!!qr}
          title={payingPremium ? t("premiumTitle") : t("title")}
          amount={payAmount}
          qr={qr ?? undefined}
          pending={!!qr}
          error={error || undefined}
          onClose={() => {
            stopPolling();
            setQr(null);
            setPayingId(null);
            setPayingPremium(false);
            setError("");
          }}
        />
      </div>
    </div>
  );
}
