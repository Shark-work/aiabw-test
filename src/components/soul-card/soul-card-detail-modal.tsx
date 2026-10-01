"use client";

/**
 * 灵魂卡详情弹窗：卡面 + 属性 + 成长 + 链上凭证/轨迹 + 销毁操作。
 * 销毁（Burn）不可逆，二次确认后调用 POST /api/soul-cards/[id]/burn。
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

import { SoulCardAttributes } from "./soul-card-attributes";
import { SoulCardCertificate } from "./soul-card-certificate";
import { SoulCardGrowth } from "./soul-card-growth";
import { SoulCardView } from "./soul-card-view";
import type {
  ChainStatusDto,
  LedgerEntryDto,
  SoulCardDto,
} from "./soul-card-types";

export function SoulCardDetailModal({
  card,
  ledger,
  chain,
  locale,
  onClose,
  onBurned,
}: {
  card: SoulCardDto;
  ledger: LedgerEntryDto[];
  chain: ChainStatusDto | null;
  locale: string;
  onClose: () => void;
  onBurned: (card: SoulCardDto) => void;
}) {
  const t = useTranslations("soulCards");
  const [confirming, setConfirming] = useState(false);
  const [burning, setBurning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = card.status === "active";

  async function handleBurn() {
    if (burning) return;
    const token =
      typeof window !== "undefined" ? localStorage.getItem("aiabw_token") : null;
    if (!token) {
      setError(t("signInFirst"));
      return;
    }
    setBurning(true);
    setError(null);
    try {
      const res = await fetch(`/api/soul-cards/${card.id}/burn`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "x-locale": locale },
      });
      const data = (await res.json()) as {
        ok: boolean;
        card?: SoulCardDto;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.card) {
        setError(data.error ?? t("burnFailed"));
        return;
      }
      onBurned(data.card);
    } catch {
      setError(t("burnFailed"));
    } finally {
      setBurning(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-4 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            {t("detail.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("detail.close")}
            className="rounded-full p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <SoulCardView card={card} locale={locale} />
          <SoulCardAttributes card={card} locale={locale} />
          <SoulCardGrowth
            level={card.growthLevel}
            exp={card.growthExp}
            locale={locale}
          />
          <SoulCardCertificate
            card={card}
            ledger={ledger}
            chain={chain}
            locale={locale}
          />

          {/* 销毁区（仅流通中的卡） */}
          {active ? (
            <div className="rounded-xl border border-red-200 p-3 dark:border-red-900/50">
              {!confirming ? (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="w-full rounded-full border border-red-300 py-1.5 text-xs font-semibold text-red-500 transition hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/40"
                >
                  {t("burn.button")}
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] leading-4 text-red-500 dark:text-red-400">
                    {t("burn.confirmHint")}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleBurn}
                      disabled={burning}
                      className="flex-1 rounded-full bg-red-500 py-1.5 text-xs font-semibold text-white transition hover:bg-red-600 disabled:opacity-50"
                    >
                      {burning ? t("burn.burning") : t("burn.confirm")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      disabled={burning}
                      className="flex-1 rounded-full border border-zinc-300 py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      {t("burn.cancel")}
                    </button>
                  </div>
                </div>
              )}
              {error ? (
                <p className="mt-1.5 text-[11px] text-red-500 dark:text-red-400">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
