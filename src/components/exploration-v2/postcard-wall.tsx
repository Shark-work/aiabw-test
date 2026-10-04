"use client";

/**
 * 明信片墙（/explore-v2，P1 故事外显 · 改动四）：
 *  - 探索产出的明信片以卡片形式展示（稀有带特效边框，点击查看故事文本）；
 *  - 系列集齐进度（系列 = 探索事件 pet_category）+ 图鉴奖励领取
 *    （POST /api/exploration/postcard-wall：服务端重算 + achievements 表幂等 + 积分入账）。
 *
 * 数据源 GET /api/exploration/postcard-wall（需登录，与面板同一 Bearer 策略）；
 * refreshKey 变化时重拉（探索完成后由父面板触发刷新）。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { POSTCARD_SETS } from "@/lib/postcard-config";

type Postcard = {
  id: string;
  eventId: string | null;
  category: string | null;
  title: string;
  description: string;
  emoji: string | null;
  rarity: string;
  isRare: boolean;
  createdAt: string;
};

type Collection = {
  category: string;
  total: number;
  owned: number;
  complete: boolean;
  claimed: boolean;
  rewardPoints: number;
};

/** 稀有度特效边框（普通灰边 / 稀有蓝晕 / 史诗紫晕）。 */
function frameClass(rarity: string): string {
  if (rarity === "epic")
    return "border-violet-400 bg-gradient-to-br from-violet-50 to-fuchsia-50 shadow-[0_0_12px_rgba(167,139,250,0.45)]";
  if (rarity === "rare")
    return "border-sky-300 bg-gradient-to-br from-sky-50 to-indigo-50 shadow-[0_0_10px_rgba(125,211,252,0.4)]";
  return "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900";
}

function setMeta(category: string) {
  return POSTCARD_SETS.find((s) => s.category === category) ?? null;
}

export function PostcardWall({ refreshKey = 0 }: { refreshKey?: number }) {
  const t = useTranslations("explorationV2.postcardWall");
  const [cards, setCards] = useState<Postcard[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Postcard | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/exploration/postcard-wall", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        setCards(d.cards ?? []);
        setCollections(d.collections ?? []);
      }
    } catch {
      /* 明信片墙拉取失败不阻断探索面板 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  /** 领取系列图鉴奖励（服务端权威重算 + 幂等；成功刷新进度 + toast）。 */
  async function claim(category: string) {
    if (claiming) return;
    setClaiming(category);
    setToast("");
    try {
      const res = await fetch("/api/exploration/postcard-wall", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("aiabw_token") ?? ""}`,
        },
        body: JSON.stringify({ category }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        setToast(t("claimSuccess", { points: d.rewardPoints }));
        await load();
      } else {
        setToast(d?.error ?? t("claimFailed"));
      }
    } catch {
      setToast(t("claimFailed"));
    } finally {
      setClaiming(null);
    }
  }

  if (loading) return null;
  // 无明信片且无系列进度可展示时整体隐藏（游客/新用户不打扰）
  if (cards.length === 0 && collections.every((c) => c.owned === 0)) {
    return null;
  }

  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          {t("title")}
        </h3>
        <p className="text-[11px] text-zinc-400">{t("subtitle")}</p>
      </div>

      {/* 系列集齐进度 + 图鉴奖励领取 */}
      <div className="flex flex-wrap gap-1.5">
        {collections.map((c) => {
          const meta = setMeta(c.category);
          return (
            <div
              key={c.category}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
                c.complete
                  ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40"
                  : "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50"
              }`}
            >
              <span aria-hidden>{meta?.emoji ?? "💌"}</span>
              <span className="font-medium text-zinc-600 dark:text-zinc-300">
                {t("collected", { owned: c.owned, total: c.total })}
              </span>
              {c.claimed ? (
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {t("claimed")}
                </span>
              ) : c.complete ? (
                <button
                  type="button"
                  onClick={() => claim(c.category)}
                  disabled={claiming === c.category}
                  className="rounded-full bg-emerald-500 px-2 py-0.5 font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-60"
                >
                  {claiming === c.category
                    ? "…"
                    : t("claim", { points: c.rewardPoints })}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {toast ? (
        <p className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {toast}
        </p>
      ) : null}

      {/* 明信片卡片墙（稀有特效边框） */}
      {cards.length === 0 ? (
        <p className="rounded-xl bg-zinc-50 px-3 py-3 text-center text-xs text-zinc-400 dark:bg-zinc-800/50">
          {t("empty")}
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {cards.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                onClick={() => setSelected(card)}
                className={`flex w-full flex-col items-center gap-1 rounded-xl border p-2.5 text-center transition hover:scale-[1.03] ${frameClass(card.rarity)}`}
              >
                <span className="text-2xl" aria-hidden>
                  {card.emoji ?? "💌"}
                </span>
                <span className="line-clamp-2 min-h-8 text-[11px] font-medium leading-4 text-zinc-700 dark:text-zinc-200">
                  {card.title}
                </span>
                <span className="text-[10px] text-zinc-400">
                  {new Date(card.createdAt).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 故事弹窗（探索奇遇文案） */}
      {selected ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className={`w-full max-w-xs space-y-3 rounded-2xl border-2 p-5 text-center shadow-xl ${frameClass(selected.rarity)}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-4xl" aria-hidden>
              {selected.emoji ?? "💌"}
            </div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {selected.title}
            </h3>
            {(selected.rarity === "rare" || selected.rarity === "epic") && (
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  selected.rarity === "epic"
                    ? "bg-violet-100 text-violet-700"
                    : "bg-sky-100 text-sky-700"
                }`}
              >
                ✨ {selected.rarity === "epic" ? t("epic") : t("rare")}
              </span>
            )}
            <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-300">
              {selected.description}
            </p>
            <p className="text-[10px] text-zinc-400">
              {new Date(selected.createdAt).toLocaleString()}
            </p>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="w-full rounded-full bg-violet-600 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700"
            >
              {t("storyTitle")} · ✕
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

