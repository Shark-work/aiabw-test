"use client";

/**
 * ShopClient · 道具商店（Phase 6 · 6.3）
 *  - 6.3.1 GET /api/item/list 展示道具（emoji/名称/效果/积分价格，公开接口）；
 *  - 6.3.2 已登录 → 数量选择（1~99，与服务端 quantity 上限一致）→「购买」
 *    → POST /api/item/buy { itemId, quantity }；
 *  - 6.3.3 购买成功 → 提示 + 余额回显，道具进入背包（/bag 中使用）；
 *  - 未登录 → 登录引导；失败 → AibiErrorBanner（INSUFFICIENT_POINTS / ITEM_NOT_FOUND 等）；
 *  - 加载骨架屏 + 按钮 loading；响应式网格。
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { LimitedOfferBanner } from "@/components/limited-offer-banner";
import { AibiErrorBanner } from "./aibi-error-banner";
import { aibiFetch, AibiClientError, readAibiToken } from "@/lib/aibi-client";
import { aibiItemEmoji } from "@/lib/aibi-visual";

interface ShopItemDto {
  id: string;
  nameZh: string;
  nameEn: string;
  itemType: string;
  effect: string | null;
  effectEn: string | null;
  effectPayload: Record<string, number> | null;
  consumeMode: string;
  affectsGrowth: boolean;
  affectsPersonality: boolean;
  pricePoints: number;
}

type LoadState = "loading" | "ready" | "error";

export function ShopClient() {
  const t = useTranslations("aibi.shop");
  const locale = useLocale();
  const isEn = locale === "en";

  const [state, setState] = useState<LoadState>("loading");
  const [items, setItems] = useState<ShopItemDto[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [notice, setNotice] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  /** 6.3.2 每道具购买数量（1~99，与服务端 quantity 上限一致），默认 1 */
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const qtyOf = (id: string) => qtyMap[id] ?? 1;
  function setQtyFor(id: string, v: number) {
    const n = Number.isFinite(v) ? Math.floor(v) : 1;
    setQtyMap((prev) => ({ ...prev, [id]: Math.min(99, Math.max(1, n)) }));
  }

  const load = useCallback(async () => {
    try {
      // 6.3.1 道具目录（公开接口）
      const data = await aibiFetch<{ items: ShopItemDto[] }>("/api/item/list", { locale });
      setItems(data.items ?? []);
      setSignedIn(!!readAibiToken());
      setState("ready");
    } catch {
      setState("error");
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 6.3.2 购买：POST /api/item/buy → 道具入背包 + 余额回显 */
  async function buy(itemId: string) {
    setBuying(itemId);
    setError(null);
    setNotice(false);
    try {
      const res = await aibiFetch<{ itemId: string; quantity: number; cost: number; balance: number }>(
        "/api/item/buy",
        { method: "POST", body: { itemId, quantity: qtyOf(itemId) }, locale },
      );
      setBalance(res.balance);
      setNotice(true);
    } catch (e) {
      if (e instanceof AibiClientError) {
        if (e.status === 401) setSignedIn(false);
        setError({ code: e.code, message: e.message });
      } else {
        setError({ message: t("buyFailed") });
      }
    } finally {
      setBuying(null);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-black text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
        {balance !== null ? (
          <p className="mt-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
            {t("balance", { points: balance })}
          </p>
        ) : null}
      </header>

      {/* Phase 7 · 7.6-1 限时特惠横幅（首充双倍 / 积分特惠，复用充值事件总线） */}
      <LimitedOfferBanner />

      {error ? <AibiErrorBanner code={error.code} message={error.message} onClose={() => setError(null)} /> : null}
      {notice ? (
        <p className="rounded-2xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {t("bought")}{" "}
          <Link href="/bag" className="font-bold underline">
            {t("goBag")}
          </Link>
        </p>
      ) : null}

      {state === "loading" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-3xl bg-zinc-100 dark:bg-zinc-800" />
          ))}
        </div>
      ) : null}

      {state === "error" ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-400 dark:border-zinc-700">
          {t("loadFailed")}
        </p>
      ) : null}

      {state === "ready" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <div
              key={it.id}
              className="flex flex-col rounded-3xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-4xl">{aibiItemEmoji(it.id)}</span>
                <p className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-sm font-black text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                  ⭐ {it.pricePoints}
                </p>
              </div>
              <h2 className="mt-2 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                {isEn ? it.nameEn : it.nameZh}
              </h2>
              <p className="mt-0.5 flex-1 text-xs text-zinc-500 dark:text-zinc-400">
                {isEn ? (it.effectEn ?? it.effect) : it.effect}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {it.affectsGrowth ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                    {t("affectsGrowth")}
                  </span>
                ) : null}
                {it.affectsPersonality ? (
                  <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-600 dark:bg-purple-950/40 dark:text-purple-400">
                    {t("affectsPersonality")}
                  </span>
                ) : null}
              </div>
              {signedIn ? (
                <div className="mt-3 space-y-2">
                  {/* 数量选择（1~99，6.3.2）+ 小计 */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center rounded-2xl border border-zinc-200 dark:border-zinc-700">
                      <button
                        type="button"
                        aria-label="decrease quantity"
                        disabled={buying !== null || qtyOf(it.id) <= 1}
                        onClick={() => setQtyFor(it.id, qtyOf(it.id) - 1)}
                        className="px-2.5 py-1.5 text-sm font-bold text-zinc-500 transition hover:text-orange-500 disabled:opacity-30"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={qtyOf(it.id)}
                        aria-label={t("quantity")}
                        onChange={(e) => setQtyFor(it.id, Number(e.target.value))}
                        className="w-11 border-x border-zinc-200 py-1.5 text-center text-sm font-bold outline-none dark:border-zinc-700 dark:bg-zinc-900"
                      />
                      <button
                        type="button"
                        aria-label="increase quantity"
                        disabled={buying !== null || qtyOf(it.id) >= 99}
                        onClick={() => setQtyFor(it.id, qtyOf(it.id) + 1)}
                        className="px-2.5 py-1.5 text-sm font-bold text-zinc-500 transition hover:text-orange-500 disabled:opacity-30"
                      >
                        ＋
                      </button>
                    </div>
                    <p className="shrink-0 text-xs font-semibold text-amber-600 dark:text-amber-400">
                      {t("subtotal", { points: it.pricePoints * qtyOf(it.id) })}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={buying !== null}
                    onClick={() => void buy(it.id)}
                    className="w-full rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    {buying === it.id ? t("buying") : t("buy")}
                  </button>
                </div>
              ) : (
                <Link
                  href="/login"
                  className="mt-3 block w-full rounded-2xl border border-orange-300 py-2.5 text-center text-sm font-bold text-orange-600 dark:border-orange-700 dark:text-orange-400"
                >
                  {t("signInToBuy")}
                </Link>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

