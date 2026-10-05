"use client";

/**
 * 灵魂卡图鉴页容器（客户端）：
 *  - 挂载时读 localStorage aiabw_token → Bearer 拉取 /api/soul-cards（我的卡）
 *    与 /api/chain/status（公开链状态，无需登录）；
 *  - 登录门槛同 explore-v2：仅确认无 token / 401 时展示登录引导（cookie 无令牌，不能 SSR 鉴权）；
 *  - 卡片点击 → 拉详情（含账本）开弹窗；销毁成功后就地刷新。
 * 唤醒即铸卡（2026-10-14）：领养时自动铸造，移除手动铸造入口与「可铸造宠物」区块。
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { CollectionProgress } from "./collection-progress";
import { SoulCardCompareModal } from "./soul-card-compare-modal";
import { SoulCardDetailModal } from "./soul-card-detail-modal";
import { SoulCardView } from "./soul-card-view";
import { featuredToDto } from "./soul-card-types";
import type {
  ChainStatusDto,
  FeaturedSoulCardDto,
  LedgerEntryDto,
  LegacyTokenDto,
  SoulCardDto,
} from "./soul-card-types";

type LoadState = "loading" | "signedOut" | "ready" | "error";
type TabId = "mine" | "hot";

type DetailState = {
  card: SoulCardDto;
  ledger: LedgerEntryDto[];
  /** 历史艾比凭证（仅卡主本人可见；公开访问/未登录为 null） */
  legacyTokens: LegacyTokenDto[] | null;
} | null;

export function SoulCardsClient() {
  const t = useTranslations("soulCards");
  const locale = useLocale();

  const [state, setState] = useState<LoadState>("loading");
  const [cards, setCards] = useState<SoulCardDto[]>([]);
  const [chain, setChain] = useState<ChainStatusDto | null>(null);
  const [detail, setDetail] = useState<DetailState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Phase 7 · 7.4-3：社区热门 tab（公开数据，未登录也可看）
  const [tab, setTab] = useState<TabId>("mine");
  const [hotCards, setHotCards] = useState<SoulCardDto[]>([]);
  const [hotLoaded, setHotLoaded] = useState(false);
  // Phase 7 · 7.4-5：卡片对比模式（仅我的收藏 tab，最多选 2 张）
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const loadAll = useCallback(async () => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("aiabw_token") : null;

    // 链状态公开可读，始终拉取
    const chainPromise = fetch("/api/chain/status")
      .then((r) => r.json())
      .then((d: { ok: boolean } & Partial<ChainStatusDto>) =>
        d.ok && d.provider && d.supply ? (d as ChainStatusDto & { ok: boolean }) : null,
      )
      .catch(() => null);

    if (!token) {
      setChain(await chainPromise);
      setState("signedOut");
      return;
    }

    try {
      const res = await fetch("/api/soul-cards", {
        headers: { Authorization: `Bearer ${token}`, "x-locale": locale },
      });
      if (res.status === 401) {
        setChain(await chainPromise);
        setState("signedOut");
        return;
      }
      const data = (await res.json()) as {
        ok: boolean;
        cards?: SoulCardDto[];
      };
      if (!res.ok || !data.ok) {
        setState("error");
        return;
      }
      setCards(data.cards ?? []);
      setChain(await chainPromise);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [locale]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // 社区热门 tab：首次切入时拉取（公开接口，无需登录；featured 口径仅 active 卡）
  useEffect(() => {
    if (tab !== "hot" || hotLoaded) return;
    let alive = true;
    fetch("/api/soul-cards/featured")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.ok && Array.isArray(d.cards)) {
          setHotCards((d.cards as FeaturedSoulCardDto[]).map(featuredToDto));
        }
      })
      .catch(() => {})
      .finally(() => alive && setHotLoaded(true));
    return () => {
      alive = false;
    };
  }, [tab, hotLoaded]);

  /** 对比模式：点选/取消卡片（最多 2 张，选满第 3 张时替换最早选择）。 */
  function toggleCompare(cardId: string) {
    setCompareIds((prev) => {
      if (prev.includes(cardId)) return prev.filter((id) => id !== cardId);
      return prev.length >= 2 ? [prev[1], cardId] : [...prev, cardId];
    });
  }

  function exitCompare() {
    setCompareMode(false);
    setCompareIds([]);
    setCompareOpen(false);
  }

  const comparePair =
    compareIds.length === 2
      ? (compareIds.map((id) => cards.find((c) => c.id === id)).filter(Boolean) as SoulCardDto[])
      : null;

  async function openDetail(cardId: string) {
    try {
      // 带 Bearer：卡主本人时服务端附带历史艾比凭证（legacyTokens）
      const token =
        typeof window !== "undefined" ? localStorage.getItem("aiabw_token") : null;
      const res = await fetch(`/api/soul-cards/${cardId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = (await res.json()) as {
        ok: boolean;
        card?: SoulCardDto;
        ledger?: LedgerEntryDto[];
        legacyTokens?: LegacyTokenDto[] | null;
      };
      if (res.ok && data.ok && data.card) {
        setDetail({
          card: data.card,
          ledger: data.ledger ?? [],
          legacyTokens: data.legacyTokens ?? null,
        });
      }
    } catch {
      /* 详情打开失败静默，列表仍可用 */
    }
  }

  function handleBurned(card: SoulCardDto) {
    setNotice(t("burn.success", { cert: card.certificateNo }));
    setDetail(null);
    void loadAll();
  }


  const supply = chain?.supply ?? null;
  const supplyPercent =
    supply && supply.maxSupply > 0
      ? Math.min(100, Math.round((supply.totalMinted / supply.maxSupply) * 100))
      : 0;

  return (
    <div className="space-y-5">
      {/* 页头 */}
      <header>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t("subtitle")}
        </p>
      </header>

      {/* 链上供应横幅（公开可验证的稀缺性） */}
      {supply ? (
        <section className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4 dark:border-amber-900/40 dark:from-amber-950/30 dark:to-orange-950/30">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("supply.title")}
            </h2>
            <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-900/60 dark:text-zinc-300">
              {chain?.provider.network}
              {chain?.provider.isSimulated ? ` · ${t("simulatedBadge")}` : ""}
            </span>
          </div>
          <p className="mt-2 font-mono text-lg font-bold tracking-wide text-zinc-900 dark:text-zinc-100">
            {supply.circulating.toLocaleString()}{" "}
            <span className="text-xs font-normal text-zinc-500">
              / {supply.maxSupply.toLocaleString()}
            </span>
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/70 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all"
              style={{ width: `${supplyPercent}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            {t("supply.stats", {
              minted: supply.totalMinted,
              burned: supply.totalBurned,
            })}
          </p>
        </section>
      ) : null}

      {/* 操作反馈 */}
      {notice ? (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}

      {/* Phase 7 · 7.4-3：tab 切换（我的收藏 / 社区热门；未登录也可看热门） */}
      <div className="flex gap-2" role="tablist">
        {(["mine", "hot"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
              tab === id
                ? "bg-orange-500 text-white shadow-sm"
                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            }`}
          >
            {id === "mine" ? t("tabs.mine", { count: cards.length }) : t("tabs.hot")}
          </button>
        ))}
      </div>

      {tab === "hot" ? (
        /* 社区热门（featured 公开口径：稀有度优先 Top10；点击进公开凭证页） */
        <section>
          {!hotLoaded ? (
            <p className="py-8 text-center text-xs text-zinc-400">{t("loading")}</p>
          ) : hotCards.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 py-10 text-center dark:border-zinc-700">
              <p className="text-3xl">🃏</p>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t("hot.empty")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {hotCards.map((card) => (
                <SoulCardView
                  key={card.id}
                  card={card}
                  locale={locale}
                  onClick={() =>
                    window.open(`/${locale}/soul-cards/${card.id}/public`, "_blank")
                  }
                />
              ))}
            </div>
          )}
        </section>
      ) : (
      /* 我的灵魂卡 */
      <section>
        <h2 className="mb-2 flex items-center justify-between gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {t("collection.title", { count: cards.length })}
          {/* Phase 7 · 7.4-5：对比模式开关（≥2 张卡可用） */}
          {state === "ready" && cards.length >= 2 ? (
            <button
              type="button"
              onClick={() => (compareMode ? exitCompare() : setCompareMode(true))}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                compareMode
                  ? "bg-violet-500 text-white shadow-sm"
                  : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {compareMode ? t("compare.exit") : t("compare.enter")}
            </button>
          ) : null}
        </h2>
        {/* Phase 7 · 7.4-2：收藏进度统计面板（有卡时展示） */}
        {state === "ready" && cards.length > 0 ? (
          <div className="mb-3">
            <CollectionProgress cards={cards} locale={locale} />
          </div>
        ) : null}
        {state === "loading" ? (
          <p className="py-8 text-center text-xs text-zinc-400">{t("loading")}</p>
        ) : state === "signedOut" ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 py-10 text-center dark:border-zinc-700">
            <p className="text-3xl">🃏</p>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {t("signInHint")}
            </p>
          </div>
        ) : state === "error" ? (
          <p className="py-8 text-center text-xs text-red-500">{t("loadFailed")}</p>
        ) : cards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 py-10 text-center dark:border-zinc-700">
            <p className="text-3xl">✨</p>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {t("collection.empty")}
            </p>
            <Link
              href="/pets"
              className="mt-3 inline-block rounded-full bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
            >
              {t("collection.goAdopt")}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {cards.map((card) => {
              const selected = compareIds.includes(card.id);
              return (
                <div key={card.id} className="relative">
                  <SoulCardView
                    card={card}
                    locale={locale}
                    onClick={() =>
                      compareMode ? toggleCompare(card.id) : void openDetail(card.id)
                    }
                  />
                  {/* 对比模式：选中角标（纯视觉 pointer-events-none，点击走卡面 button） */}
                  {compareMode ? (
                    <span
                      className={`pointer-events-none absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold shadow-sm ${
                        selected
                          ? "border-violet-500 bg-violet-500 text-white"
                          : "border-white bg-black/25 text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                  ) : null}
                  {compareMode && selected ? (
                    <span className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-violet-500" />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}

      {/* Phase 7 · 7.4-5：对比浮条（选满 2 张可开启对照弹窗） */}
      {compareMode && tab === "mine" ? (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-violet-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur dark:border-violet-800 dark:bg-zinc-900/95">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {t("compare.selected", { count: compareIds.length })}
          </span>
          <button
            type="button"
            disabled={compareIds.length < 2}
            onClick={() => setCompareOpen(true)}
            className="rounded-full bg-violet-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("compare.start")}
          </button>
        </div>
      ) : null}

      {/* 对比弹窗 */}
      {compareOpen && comparePair ? (
        <SoulCardCompareModal
          a={comparePair[0]}
          b={comparePair[1]}
          locale={locale}
          onClose={() => setCompareOpen(false)}
        />
      ) : null}

      {/* 详情弹窗 */}
      {detail ? (
        <SoulCardDetailModal
          card={detail.card}
          ledger={detail.ledger}
          legacyTokens={detail.legacyTokens}
          chain={chain}
          locale={locale}
          onClose={() => setDetail(null)}
          onBurned={handleBurned}
        />
      ) : null}
    </div>
  );
}

