"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { LivingPet } from "@/components/LivingPet";
import { PromoteModal } from "@/components/promote-modal";
import { getRarityMeta } from "@/lib/pet-status";
import {
  LEADERBOARD_CATEGORIES,
  LEADERBOARD_PERIODS,
  type LeaderboardCategory,
  type LeaderboardPeriod,
} from "@/lib/leaderboard";

type PetItem = {
  rank: number;
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  rarity: string;
  element: string | null;
  generation: number;
  power: number;
  imageUrl: string;
};
type CountItem = { rank: number; ownerId: string; ownerName: string; count: number };
type MyRank = { rank: number; value: number; name?: string };
type Promotion = {
  id: string;
  contentId: string;
  endTime: string;
  generation: number;
  name: string;
  rarity: string;
  element: string | null;
  imageUrl: string;
  ownerId: string;
  ownerName: string;
};

const RANK_MEDALS = ["👑", "🥈", "🥉"];
const RANK_TOP_CLASS = [
  "border-amber-400 bg-gradient-to-br from-amber-50 via-yellow-50 to-amber-100 shadow-lg",
  "border-zinc-300 bg-gradient-to-br from-zinc-50 to-slate-100 shadow",
  "border-orange-300 bg-gradient-to-br from-orange-50 to-rose-50 shadow",
];

const CATEGORY_LABEL_KEY: Record<LeaderboardCategory, string> = {
  popularity: "catPopularity",
  collection: "catCollection",
  exploration: "catExploration",
  creation: "catCreation",
};
const PERIOD_LABEL_KEY: Record<LeaderboardPeriod, string> = {
  day: "periodDay",
  week: "periodWeek",
  month: "periodMonth",
  all: "periodAll",
};
/** 各计数榜数值单位标签（i18n key） */
const UNIT_KEY: Record<Exclude<LeaderboardCategory, "popularity">, string> = {
  collection: "unitCollection",
  exploration: "unitExploration",
  creation: "unitCreation",
};

/**
 * 增强排行榜（产品升级 Phase 5）：
 *  - 四分类（人气/收藏/探索/创作）× 四周期（日/周/月/总）多维切换；
 *  - 顶部付费推荐位坑位展示 + 「推广我的藏品」CTA（PromoteModal 积分购买）；
 *  - 前三名奖牌大卡片（宠物类含大图），4-20 名紧凑列表；
 *  - 登录用户 myRank 高亮横幅；每条目分享按钮（navigator.share → 剪贴板兜底）；
 *  - 支持 ?promote=<contentId> 直达开弹窗（灵魂卡/藏品详情「推广」按钮跳转）。
 */
export function LeaderboardV2() {
  const t = useTranslations("leaderboard");
  const locale = useLocale();
  const [category, setCategory] = useState<LeaderboardCategory>("popularity");
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [items, setItems] = useState<Array<PetItem | CountItem>>([]);
  const [promoted, setPromoted] = useState<Promotion[]>([]);
  const [myRank, setMyRank] = useState<MyRank | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promotePreselect, setPromotePreselect] = useState<string | null>(null);

  const showToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = localStorage.getItem("aiabw_token");
      const res = await fetch(`/api/leaderboard?category=${category}&period=${period}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        cache: "no-store",
      });
      const d = await res.json().catch(() => null);
      if (d?.ok) {
        setItems(d.items ?? []);
        setPromoted(d.promoted ?? []);
        setMyRank(d.myRank ?? null);
      } else {
        setError(t("loadFailed"));
      }
    } catch {
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [category, period, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // ?promote=<contentId> 直达（藏品详情页「推广」按钮跳转目标）
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("promote");
    if (q) {
      setPromotePreselect(q);
      setPromoteOpen(true);
    }
  }, []);

  const shareItem = useCallback(
    async (text: string) => {
      const url = `${window.location.origin}/${locale}/leaderboard`;
      try {
        if (navigator.share) {
          await navigator.share({ title: document.title, text, url });
          return;
        }
        await navigator.clipboard.writeText(`${text} ${url}`);
        showToast(t("shared"));
      } catch {
        // 用户取消分享：静默
      }
    },
    [locale, showToast, t],
  );

  const isPetBoard = category === "popularity";
  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-xs font-semibold transition ${
      active ? "bg-orange-500 text-white shadow" : "bg-white text-zinc-600 hover:bg-orange-50"
    }`;

  /** 前三奖牌大卡片（宠物类带大图；计数类主人头像位用首字符） */
  const renderTopCard = (item: PetItem | CountItem) => {
    const pet = item as PetItem;
    const top = item.rank - 1;
    return (
      <div
        key={isPetBoard ? pet.id : (item as CountItem).ownerId}
        data-testid={`rank-card-${item.rank}`}
        className={`relative flex flex-col items-center rounded-2xl border px-3 py-4 text-center ${RANK_TOP_CLASS[top]}`}
      >
        <span className="text-2xl">{RANK_MEDALS[top]}</span>
        {isPetBoard ? (
          <>
            <LivingPet
              src={pet.imageUrl}
              alt={pet.name}
              tail={false}
              className="mt-1 h-16 w-16 rounded-full border-2 border-white bg-orange-50 object-cover shadow"
            />
            <p className="mt-1.5 w-full truncate text-sm font-bold text-zinc-800">{pet.name}</p>
            <p className="w-full truncate text-[10px] text-zinc-500">
              {t("owner", { name: pet.ownerName })} · {t("generation", { gen: pet.generation })}
            </p>
            <p className="mt-1 text-base font-extrabold text-orange-600">{(pet.power ?? 0).toLocaleString()}</p>
            <p className="text-[10px] text-zinc-400">{t("power")}</p>
          </>
        ) : (
          <>
            <span className="mt-1 flex h-14 w-14 items-center justify-center rounded-full bg-white/80 text-xl font-extrabold text-orange-500 shadow">
              {item.ownerName.slice(0, 1)}
            </span>
            <p className="mt-1.5 w-full truncate text-sm font-bold text-zinc-800">{item.ownerName}</p>
            <p className="mt-1 text-base font-extrabold text-violet-600">{((item as CountItem).count ?? 0).toLocaleString()}</p>
            <p className="text-[10px] text-zinc-400">{t(UNIT_KEY[category as Exclude<LeaderboardCategory, "popularity">])}</p>
          </>
        )}
        <button
          type="button"
          data-testid={`share-rank-${item.rank}`}
          onClick={() =>
            void shareItem(
              isPetBoard
                ? t("shareTextPet", { rank: item.rank, name: pet.name, owner: pet.ownerName })
                : t("shareTextUser", { rank: item.rank, name: item.ownerName }),
            )
          }
          className="absolute right-2 top-2 rounded-full bg-white/70 px-2 py-1 text-[10px] text-zinc-500 shadow-sm hover:bg-white"
          title={t("share")}
        >
          🔗
        </button>
      </div>
    );
  };

  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm backdrop-blur">
      {/* 头部：标题 + 推广入口 */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-zinc-800">🏆 {t("title")}</h2>
        <button
          type="button"
          data-testid="promote-open-btn"
          onClick={() => {
            setPromotePreselect(null);
            setPromoteOpen(true);
          }}
          className="rounded-full bg-gradient-to-r from-orange-500 to-amber-500 px-3 py-1.5 text-xs font-bold text-white shadow hover:opacity-90"
        >
          📣 {t("promoteCta")}
        </button>
      </div>

      {/* 分类 Tab × 4 */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {LEADERBOARD_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            data-testid={`cat-tab-${c}`}
            className={chip(category === c)}
            onClick={() => {
              if (c === category) return;
              // 竞态修复（2026-10-16 生产白屏）：setCategory 触发同步重渲时 useEffect 尚未执行，
              // 旧 items 结构（CountItem）会在新分类（popularity）分支下渲染一帧，
              // pet.power 为 undefined → 调用其 toLocaleString 抛 TypeError 白屏。
              // 必须在切换分类的同步路径上清空旧结构数据。
              setItems([]);
              setMyRank(null);
              setCategory(c);
            }}
          >
            {t(CATEGORY_LABEL_KEY[c])}
          </button>
        ))}
      </div>

      {/* 周期 Tab × 4（人气榜为累计口径，隐藏） */}
      {!isPetBoard && (
        <div className="mb-3 flex flex-wrap gap-1.5" data-testid="period-tabs">
          {LEADERBOARD_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              data-testid={`period-tab-${p}`}
              className={`${chip(period === p)} !bg-opacity-90`}
              onClick={() => {
                if (p === period) return;
                // 同 category 竞态防护：清空旧周期数据，避免 loading 生效前渲染过期计数
                setItems([]);
                setMyRank(null);
                setPeriod(p);
              }}
            >
              {t(PERIOD_LABEL_KEY[p])}
            </button>
          ))}
        </div>
      )}

      {/* 付费推荐位坑位 */}
      {promoted.length > 0 && (
        <div data-testid="promoted-section" className="mb-4 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-3">
          <p className="mb-2 text-xs font-bold text-amber-700">📌 {t("promotedTitle")}</p>
          <div className="grid grid-cols-3 gap-2">
            {promoted.map((p, i) => {
              const meta = getRarityMeta(p.rarity);
              return (
                <div key={p.id} data-testid={`promoted-slot-${i}`} className="relative rounded-xl border border-amber-100 bg-white p-2 text-center shadow-sm">
                  <span className="absolute left-1 top-1 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-white">
                    {t("promotedBadge")}
                  </span>
                  <LivingPet
                    src={p.imageUrl}
                    alt={p.name}
                    tail={false}
                    className="mx-auto h-12 w-12 rounded-full border border-amber-100 bg-amber-50 object-cover"
                  />
                  <p className="mt-1 truncate text-xs font-semibold text-zinc-700">{p.name}</p>
                  <p className="truncate text-[10px] text-zinc-400">
                    {meta.emoji} ×{p.generation} · {t("owner", { name: p.ownerName })}
                  </p>
                  <p className="text-[9px] text-amber-500">
                    {t("endsAt", { time: new Date(p.endTime).toLocaleDateString(locale === "en" ? "en-US" : "zh-CN") })}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}


      {/* 我的排名横幅（登录且在榜/有计数） */}
      {myRank && (
        <div data-testid="my-rank-banner" className="mb-3 flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50 px-3 py-2">
          <span className="text-xs font-semibold text-violet-700">
            🎖️ {t("myRankBanner", { rank: myRank.rank })}
          </span>
          <span className="text-sm font-extrabold text-violet-600">
            {(myRank.value ?? 0).toLocaleString()}
            {myRank.name ? <span className="ml-1 text-[10px] font-normal text-violet-400">({myRank.name})</span> : null}
          </span>
        </div>
      )}

      {loading && <p className="py-10 text-center text-sm text-zinc-400">{t("loading")}</p>}
      {error && <p className="py-10 text-center text-sm text-red-500">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <p className="py-10 text-center text-sm text-zinc-400">{t("empty")}</p>
      )}

      {!loading && !error && items.length > 0 && (
        <>
          {/* 前三名奖牌大卡片 */}
          <div className="mb-4 grid grid-cols-3 gap-2">{items.slice(0, 3).map(renderTopCard)}</div>

          {/* 4-20 名紧凑列表 */}
          <ol className="space-y-1.5">
            {items.slice(3).map((raw) => {
              const item = raw as PetItem & CountItem;
              const shareBtn = (
                <button
                  type="button"
                  data-testid={`share-rank-${item.rank}`}
                  onClick={() =>
                    void shareItem(
                      isPetBoard
                        ? t("shareTextPet", { rank: item.rank, name: item.name, owner: item.ownerName })
                        : t("shareTextUser", { rank: item.rank, name: item.ownerName }),
                    )
                  }
                  className="shrink-0 rounded-full px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-100"
                  title={t("share")}
                >
                  🔗
                </button>
              );
              return (
                <li
                  key={isPetBoard ? item.id : item.ownerId}
                  data-testid={`rank-row-${item.rank}`}
                  className="flex items-center gap-3 rounded-xl border border-zinc-100 bg-white px-3 py-2"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-zinc-400">
                    {item.rank}
                  </span>
                  {isPetBoard ? (
                    <>
                      <LivingPet
                        src={item.imageUrl}
                        alt={item.name}
                        tail={false}
                        className="h-9 w-9 shrink-0 rounded-full border border-orange-200 bg-orange-50 object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="truncate text-sm font-semibold text-zinc-800">{item.name}</span>
                        <div className="truncate text-[11px] text-zinc-400">
                          {t("owner", { name: item.ownerName })} · {t("generation", { gen: item.generation })}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-bold text-orange-600">{(item.power ?? 0).toLocaleString()}</div>
                        <div className="text-[10px] text-zinc-400">{t("power")}</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-50 text-sm font-bold text-violet-500">
                        {item.ownerName.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-800">{item.ownerName}</span>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-bold text-violet-600">{(item.count ?? 0).toLocaleString()}</div>
                        <div className="text-[10px] text-zinc-400">
                          {t(UNIT_KEY[category as Exclude<LeaderboardCategory, "popularity">])}
                        </div>
                      </div>
                    </>
                  )}
                  {shareBtn}
                </li>
              );
            })}
          </ol>
        </>
      )}

      {/* 轻量 toast */}
      {toast && (
        <div data-testid="lb-toast" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-zinc-800 px-4 py-2 text-xs text-white shadow-lg">
          {toast}
        </div>
      )}

      <PromoteModal
        open={promoteOpen}
        initialContentId={promotePreselect}
        onClose={() => setPromoteOpen(false)}
        onPromoted={() => void load()}
      />
    </div>
  );
}

