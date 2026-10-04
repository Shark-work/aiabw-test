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
import { SoulCardDetailModal } from "./soul-card-detail-modal";
import { SoulCardView } from "./soul-card-view";
import type {
  ChainStatusDto,
  LedgerEntryDto,
  SoulCardDto,
} from "./soul-card-types";

type LoadState = "loading" | "signedOut" | "ready" | "error";

type DetailState = {
  card: SoulCardDto;
  ledger: LedgerEntryDto[];
} | null;

export function SoulCardsClient() {
  const t = useTranslations("soulCards");
  const locale = useLocale();

  const [state, setState] = useState<LoadState>("loading");
  const [cards, setCards] = useState<SoulCardDto[]>([]);
  const [chain, setChain] = useState<ChainStatusDto | null>(null);
  const [detail, setDetail] = useState<DetailState>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  async function openDetail(cardId: string) {
    try {
      const res = await fetch(`/api/soul-cards/${cardId}`);
      const data = (await res.json()) as {
        ok: boolean;
        card?: SoulCardDto;
        ledger?: LedgerEntryDto[];
      };
      if (res.ok && data.ok && data.card) {
        setDetail({ card: data.card, ledger: data.ledger ?? [] });
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

      {/* 我的灵魂卡 */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {t("collection.title", { count: cards.length })}
        </h2>
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
            {cards.map((card) => (
              <SoulCardView
                key={card.id}
                card={card}
                locale={locale}
                onClick={() => void openDetail(card.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* 详情弹窗 */}
      {detail ? (
        <SoulCardDetailModal
          card={detail.card}
          ledger={detail.ledger}
          chain={chain}
          locale={locale}
          onClose={() => setDetail(null)}
          onBurned={handleBurned}
        />
      ) : null}
    </div>
  );
}

