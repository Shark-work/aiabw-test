"use client";

/**
 * 宠物旅行日记 · 地图组件
 *  - 接收 SSR 加载的初始状态（currentMapId / mapProgress / explorationSteps / weather）；
 *  - 通过 props 接受父组件（chat-client）传入的 pendingEvents 来显示事件弹窗；
 *  - 渲染：顶部信息条 / 主地图区 220px / 背包 + 明信片侧栏 / 事件弹窗。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { X, MapPin, Package, Image as ImageIcon, ShoppingBag, Coins, Lock, Loader2, Sparkles } from "lucide-react";
import {
  EXPLORATION_MAPS,
  type ExplorationItem,
  type Weather,
} from "@/lib/exploration-config";

export type ExplorationState = {
  adoptionId: string;
  explorationSteps: number;
  currentMapId: number;
  mapProgress: number;
  weather: Weather;
};

export type ExplorationEvent = {
  type: "item" | "weather" | "npc" | "obstacle";
  title: string;
  description: string;
  rewardItemKey: string | null;
};

/** 商城商品类型（与 /api/shop/items 返回一致） */
export type ShopApiItem = {
  id: string;
  name: string;
  nameZh: string;
  nameEn: string;
  description: string;
  descriptionZh: string;
  descriptionEn: string;
  icon: string;
  price: number;
  currency: string;
  effectType: string;
  effectValue: number;
  duration: number;
  isPremium: boolean;
  sortOrder: number;
  owned: boolean;
  locked: boolean;
};

/** 已购装备（用于装备状态栏） */
export type EquippedGear = {
  key: string;
  icon: string;
  name: string;
};

type Props = {
  initialState: ExplorationState;
  petName: string;
  petAvatar: string;
  pendingEvents?: ExplorationEvent[];
  onClearEvents?: () => void;
};

const WEATHER_ICON: Record<Weather, string> = {
  sunny: "☀️",
  rainy: "🌧️",
  snowy: "❄️",
  cloudy: "⛅",
};

export function ExplorationMap({
  initialState,
  petName,
  petAvatar,
  pendingEvents = [],
  onClearEvents,
}: Props) {
  const t = useTranslations("exploration");
  const tShop = useTranslations("shop");
  const tCommon = useTranslations("common");
  const currentLocale = useLocale();
  // 从 cookie 推断 locale（SSR 不可用，所以这里只在客户端判断；fallback zh）
  const locale: "zh" | "en" =
    (typeof document !== "undefined"
      ? (document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=(zh|en)/)?.[1] as "zh" | "en" | undefined)
      : undefined) || "zh";
  const [state, setState] = useState<ExplorationState>(initialState);
  const [backpackOpen, setBackpackOpen] = useState(false);
  const [postcardOpen, setPostcardOpen] = useState(false);
  const [items, setItems] = useState<ExplorationItem[]>([]);
  const [walking, setWalking] = useState(false);
  const [activeEvent, setActiveEvent] = useState<ExplorationEvent | null>(null);
  const [postcardToast, setPostcardToast] = useState<string | null>(null);
  // 商城：商品列表 / 金币 / 月卡状态 / 购买中 id / 已购装备（用于顶部状态栏）
  const [shopOpen, setShopOpen] = useState(false);
  const [shopItems, setShopItems] = useState<ShopApiItem[]>([]);
  const [shopLoading, setShopLoading] = useState(false);
  const [coins, setCoins] = useState<number | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [shopToast, setShopToast] = useState<string | null>(null);
  const [equipped, setEquipped] = useState<EquippedGear[]>([]);

  useEffect(() => {
    if (pendingEvents.length > 0) {
      setActiveEvent(pendingEvents[0]);
      setWalking(false);
    }
  }, [pendingEvents]);

  useEffect(() => {
    setState(initialState);
  }, [initialState]);

  useEffect(() => {
    setWalking(true);
    const tm = setTimeout(() => setWalking(false), 1200);
    return () => clearTimeout(tm);
  }, [state.explorationSteps]);

  useEffect(() => {
    if (state.mapProgress === 0 && state.explorationSteps > 0) {
      const mapName = t(`map.map${state.currentMapId}`);
      setPostcardToast(t("events.reached", { map: mapName }));
      const tm = setTimeout(() => setPostcardToast(null), 2500);
      return () => clearTimeout(tm);
    }
  }, [state.currentMapId, state.mapProgress, state.explorationSteps, t]);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/user/items?source=exploration");
      const data = await res.json();
      if (data?.ok && Array.isArray(data.items)) {
        setItems(data.items as ExplorationItem[]);
      }
    } catch {
      // 静默
    }
  }, []);

  /** 拉取已购商城装备（去重 + 按 sortOrder 排序）→ 顶部状态栏展示 */
  const fetchEquipped = useCallback(async () => {
    try {
      const res = await fetch("/api/shop/inventory");
      if (res.status === 401) { setEquipped([]); return; }
      const data = await res.json();
      if (data?.ok && Array.isArray(data.items)) {
        // 去重：同 itemKey 保留最早一条；并过滤 duration !== -1（消耗品）暂不显示
        const seen = new Set<string>();
        const list: EquippedGear[] = [];
        for (const it of data.items as Array<{ itemKey: string; icon: string; name: string; duration: number }>) {
          if (it.duration !== -1) continue; // 消耗品不在状态栏显示
          if (seen.has(it.itemKey)) continue;
          seen.add(it.itemKey);
          list.push({ key: it.itemKey, icon: it.icon || "🎁", name: it.name || it.itemKey });
        }
        setEquipped(list);
      }
    } catch {
      // 静默
    }
  }, []);

  /** 拉取商城商品列表 + 金币余额 + 月卡状态 */
  const fetchShop = useCallback(async () => {
    setShopLoading(true);
    try {
      const res = await fetch("/api/shop/items");
      const data = await res.json();
      if (data?.ok) {
        setShopItems(Array.isArray(data.items) ? (data.items as ShopApiItem[]) : []);
        setCoins(typeof data.coins === "number" ? data.coins : null);
        setIsPremium(!!data.premium);
      }
    } catch {
      // 静默（前端展示用）
    } finally {
      setShopLoading(false);
    }
  }, []);

  /** 购买指定商品：POST /api/shop/purchase */
  const handlePurchase = useCallback(
    async (itemId: string) => {
      if (purchasingId) return;
      setPurchasingId(itemId);
      try {
        const res = await fetch("/api/shop/purchase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, quantity: 1 }),
        });
        const data = await res.json();
        if (data?.ok && data.success) {
          setCoins(typeof data.remainingCoins === "number" ? data.remainingCoins : coins);
          setShopToast(t("shop.success"));
          // 刷新商品列表（更新 owned 状态）
          await fetchShop();
          // 刷新已购装备（顶部状态栏）
          await fetchEquipped();
        } else if (data?.error) {
          setShopToast(data.error);
        }
      } catch {
        setShopToast(t("shop.loadFailed"));
      } finally {
        setPurchasingId(null);
        const tm = setTimeout(() => setShopToast(null), 2200);
        return () => clearTimeout(tm);
      }
    },
    [purchasingId, coins, t, fetchShop, fetchEquipped],
  );

  // 打开商城时拉数据；初次挂载时也拉一次已购装备（顶部状态栏）
  useEffect(() => {
    void fetchEquipped();
  }, [fetchEquipped]);
  useEffect(() => {
    if (shopOpen && shopItems.length === 0 && !shopLoading) {
      void fetchShop();
    }
  }, [shopOpen, shopItems.length, shopLoading, fetchShop]);

  const handleContinue = useCallback(() => {
    setActiveEvent(null);
    onClearEvents?.();
  }, [onClearEvents]);

  const mapInfo = EXPLORATION_MAPS.find((m) => m.id === state.currentMapId);
  const progressPercent = Math.round((state.mapProgress / 100) * 100);
  const km = (state.explorationSteps * 0.05).toFixed(1);

  return (
    <div className="relative shrink-0 overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
      {/* V1→V2 迁移引导条：旧版挂机探索迁移期仍可用，引导用户前往新版随机事件探索
          （roadmap 三·步骤 2；V1 下线（步骤 4）时随本组件一并移除） */}
      <Link
        href={`/${currentLocale}/explore-v2`}
        data-testid="explore-v2-banner"
        className="flex items-center justify-center gap-1.5 border-b border-violet-200 bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:from-violet-600 hover:to-fuchsia-600"
      >
        <Sparkles className="h-3 w-3" aria-hidden />
        {t("v2Banner")}
      </Link>
      <div className="flex items-center justify-between gap-2 border-b border-amber-100 bg-gradient-to-r from-amber-50 to-orange-50 px-3 py-2 text-xs">
        <div className="flex items-center gap-2 truncate">
          <span className="text-lg" aria-hidden>
            {mapInfo?.emoji ?? "🗺️"}
          </span>
          <span className="truncate font-semibold text-zinc-700">
            {mapInfo ? t(`map.${mapInfo.i18nNameKey}`) : t("loading")}
          </span>
          <span className="text-zinc-500">·</span>
          <span aria-hidden>{WEATHER_ICON[state.weather]}</span>
          <span className="text-zinc-500">{t(`weather.${state.weather}`)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => { setBackpackOpen(true); fetchItems(); }}
            className="flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs text-zinc-600 transition hover:bg-amber-100"
            title={t("backpack")}
          >
            <Package className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("backpack")}</span>
          </button>
          <button
            type="button"
            onClick={() => setPostcardOpen(true)}
            className="flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs text-zinc-600 transition hover:bg-amber-100"
            title={t("postcards")}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("postcards")}</span>
          </button>
          <button
            type="button"
            onClick={() => setShopOpen(true)}
            className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-white shadow-sm transition ${
              isPremium
                ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600"
                : "bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600"
            }`}
            title={isPremium ? `${tShop("title")} (${tShop("premiumBadge")})` : tShop("title")}
            data-testid="open-shop"
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">🛒</span>
            {isPremium && <span className="hidden sm:inline" aria-hidden>⭐</span>}
            {coins !== null && (
              <span className="ml-0.5 flex items-center gap-0.5 rounded-full bg-white/30 px-1.5 text-[10px]">
                <Coins className="h-3 w-3" />
                {coins}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 已购装备状态栏（顶部信息条下方） */}
      {equipped.length > 0 && (
        <div className="mt-1 flex items-center gap-1 overflow-x-auto px-1">
          <span className="shrink-0 text-[10px] text-zinc-500">
            {locale === "en" ? "Equipped" : "已装备"}:
          </span>
          {equipped.map((g) => (
            <span
              key={g.key}
              className="flex shrink-0 items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-xs text-violet-700"
              title={g.name}
            >
              <span aria-hidden>{g.icon}</span>
              <span className="hidden text-[10px] md:inline">{g.name}</span>
            </span>
          ))}
        </div>
      )}

      <div
        className="relative h-[220px] w-full overflow-hidden"
        style={{ background: mapInfo?.gradient ?? "linear-gradient(180deg,#fef3c7,#fed7aa)" }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-around text-3xl opacity-70" aria-hidden>
          <span>☁️</span>
          <span>⛰️</span>
          <span>☁️</span>
          <span>🌳</span>
          <span>☁️</span>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-12 flex items-end justify-around text-4xl" aria-hidden>
          <span>🌲</span>
          <span>🌳</span>
          <span>🪨</span>
          <span>🌸</span>
          <span>🌲</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-amber-700/30 to-transparent" />

        <div
          className="absolute bottom-12 transition-all duration-700"
          style={{
            left: `${Math.max(2, Math.min(96, state.mapProgress))}%`,
            transform: walking ? "translateY(-2px)" : "translateY(0)",
          }}
        >
          <div className="relative">
            <img
              src={petAvatar}
              alt={petName}
              className={`h-12 w-12 rounded-full border-2 border-white object-cover shadow-md ${
                walking ? "animate-bounce" : "animate-pulse"
              }`}
            />
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px]">👣</span>
          </div>
        </div>

        <div className="absolute inset-x-3 top-3">
          <div className="flex items-center justify-between text-[10px] text-zinc-600">
            <span>
              <MapPin className="inline h-3 w-3" /> {t("stats.progress", { percent: progressPercent })}
            </span>
            <span>
              {t("stats.km", { km })} · {t("stats.steps", { count: state.explorationSteps })}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/60">
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-400 to-pink-500 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {postcardToast && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/95 px-4 py-2 text-sm font-semibold text-white shadow-lg">
            ✨ {postcardToast}
          </div>
        )}

        <div className="absolute bottom-2 left-3 text-[10px] text-zinc-700/80">
          {t("subtitle")} · {petName}
        </div>
      </div>

      {activeEvent && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-amber-200 bg-white p-4 shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                {t(`events.${activeEvent.type}`)}
              </span>
              <button
                type="button"
                onClick={handleContinue}
                className="text-zinc-400 hover:text-zinc-600"
                aria-label={tCommon("close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <h3 className="text-base font-bold text-zinc-900">{activeEvent.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-700">{activeEvent.description}</p>
            {activeEvent.rewardItemKey && (
              <p className="mt-2 text-xs text-amber-700">
                🎁 {t("events.got")} · {activeEvent.rewardItemKey}
              </p>
            )}
            <button
              type="button"
              onClick={handleContinue}
              className="mt-3 w-full rounded-full bg-gradient-to-r from-orange-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white shadow transition hover:from-orange-600 hover:to-pink-600"
            >
              {t("events.continue")}
            </button>
          </div>
        </div>
      )}

      {backpackOpen && (
        <div className="absolute inset-0 z-20 flex items-stretch justify-end bg-zinc-900/40 backdrop-blur-sm" onClick={() => setBackpackOpen(false)}>
          <div
            className="flex h-full w-72 flex-col gap-3 overflow-y-auto bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-zinc-900">🎒 {t("panel.backpackTitle")}</h3>
              <button
                type="button"
                onClick={() => setBackpackOpen(false)}
                className="text-zinc-400 hover:text-zinc-600"
                aria-label={tCommon("close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {items.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-200 p-6 text-center text-xs text-zinc-500">
                {t("panel.empty")}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {items.map((it, idx) => (
                  <div
                    key={`${it.key}-${idx}`}
                    className="flex flex-col items-center gap-1 rounded-xl border border-zinc-100 bg-amber-50 p-2 text-center"
                  >
                    <span className="text-2xl" aria-hidden>🎁</span>
                    <span className="text-[10px] font-medium text-zinc-700">{it.key}</span>
                    <span className="rounded-full bg-white px-1.5 py-0.5 text-[9px] text-amber-700">
                      {it.rarity}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {postcardOpen && (
        <div className="absolute inset-0 z-20 flex items-stretch justify-end bg-zinc-900/40 backdrop-blur-sm" onClick={() => setPostcardOpen(false)}>
          <div
            className="flex h-full w-80 flex-col gap-3 overflow-y-auto bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-zinc-900">🖼️ {t("postcard.title")}</h3>
              <button
                type="button"
                onClick={() => setPostcardOpen(false)}
                className="text-zinc-400 hover:text-zinc-600"
                aria-label={tCommon("close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-zinc-500">{t("postcard.empty")}</p>
          </div>
        </div>
      )}

      {shopOpen && (
        <div className="absolute inset-0 z-20 flex items-stretch justify-end bg-zinc-900/40 backdrop-blur-sm" onClick={() => setShopOpen(false)}>
          <div className="flex h-full w-80 flex-col gap-3 overflow-y-auto bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-zinc-900">🛒 {tShop("title")}</h3>
              <button type="button" onClick={() => setShopOpen(false)} className="text-zinc-400 hover:text-zinc-600" aria-label={tCommon("close")}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[11px] text-zinc-500">{tShop("subtitle")}</p>
            <div className="flex items-center justify-between rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 px-3 py-2 text-sm">
              <span className="font-semibold text-amber-700">💰 {tShop("coins")}</span>
              <span className="font-bold text-amber-700" data-testid="shop-coins">{coins ?? "—"}</span>
            </div>
            {shopToast && (
              <div className="rounded-lg bg-emerald-50 px-3 py-1.5 text-center text-xs text-emerald-700">{shopToast}</div>
            )}
            {shopLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                {tShop("empty").replace("…", "")}
              </div>
            ) : shopItems.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-200 p-6 text-center text-xs text-zinc-500">{tShop("empty")}</p>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {shopItems.map((it) => {
                  const canAfford = coins !== null && coins >= it.price;
                  const buying = purchasingId === it.id;
                  return (
                    <div key={it.id} data-testid={`shop-item-${it.id}`} className={`relative flex items-start gap-3 rounded-xl border p-2.5 transition ${it.owned ? "border-emerald-200 bg-emerald-50" : it.locked ? "border-zinc-200 bg-zinc-50 opacity-60" : canAfford ? "border-amber-200 bg-white hover:bg-amber-50" : "border-zinc-200 bg-white opacity-70"}`}>
                      <span className="text-3xl" aria-hidden>{it.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-zinc-900">{it.name}</span>
                          {it.isPremium && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">{tShop("premiumBadge")}</span>
                          )}
                          {it.owned && (
                            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">✓</span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{it.description}</p>
                        <div className="mt-1.5 flex items-center justify-between">
                          <span className="text-xs font-bold text-amber-600">💰 {it.price}</span>
                          {it.owned ? (
                            <span className="text-[10px] text-emerald-600">{tShop("owned")}</span>
                          ) : it.locked ? (
                            <span className="flex items-center gap-0.5 text-[10px] text-zinc-500">
                              <Lock className="h-3 w-3" />
                              {tShop("lockedHint")}
                            </span>
                          ) : !canAfford ? (
                            <span className="text-[10px] text-zinc-500">{tShop("noCoins")}</span>
                          ) : (
                            <button type="button" onClick={() => handlePurchase(it.id)} disabled={buying} className="rounded-full bg-gradient-to-r from-orange-500 to-pink-500 px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:from-orange-600 hover:to-pink-600 disabled:opacity-60">
                              {buying ? tShop("purchasing") : tShop("purchase")}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


