"use client";

/**
 * 宠物旅行日记 · 地图组件
 *  - 接收 SSR 加载的初始状态（currentMapId / mapProgress / explorationSteps / weather）；
 *  - 通过 props 接受父组件（chat-client）传入的 pendingEvents 来显示事件弹窗；
 *  - 渲染：顶部信息条 / 主地图区 220px / 背包 + 明信片侧栏 / 事件弹窗。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { X, MapPin, Package, Image as ImageIcon } from "lucide-react";
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
  const tCommon = useTranslations("common");
  const [state, setState] = useState<ExplorationState>(initialState);
  const [backpackOpen, setBackpackOpen] = useState(false);
  const [postcardOpen, setPostcardOpen] = useState(false);
  const [items, setItems] = useState<ExplorationItem[]>([]);
  const [walking, setWalking] = useState(false);
  const [activeEvent, setActiveEvent] = useState<ExplorationEvent | null>(null);
  const [postcardToast, setPostcardToast] = useState<string | null>(null);

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

  const handleContinue = useCallback(() => {
    setActiveEvent(null);
    onClearEvents?.();
  }, [onClearEvents]);

  const mapInfo = EXPLORATION_MAPS.find((m) => m.id === state.currentMapId);
  const progressPercent = Math.round((state.mapProgress / 100) * 100);
  const km = (state.explorationSteps * 0.05).toFixed(1);

  return (
    <div className="relative shrink-0 overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
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
        </div>
      </div>

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
    </div>
  );
}
