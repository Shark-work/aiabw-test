"use client";

/**
 * 链上凭证区块：tokenId / 凭证编号 / 状态 / mint·burn 交易哈希 +
 * 账本轨迹（mint → transfer → burn）。纯展示组件。
 */

import { useTranslations } from "next-intl";

import {
  truncateHash,
  type ChainStatusDto,
  type LedgerEntryDto,
  type SoulCardDto,
} from "./soul-card-types";

const TX_TYPE_EMOJI: Record<LedgerEntryDto["txType"], string> = {
  mint: "🪙",
  transfer: "🔁",
  burn: "🔥",
};

export function SoulCardCertificate({
  card,
  ledger,
  chain,
  locale,
}: {
  card: SoulCardDto;
  ledger: LedgerEntryDto[];
  chain: ChainStatusDto | null;
  locale: string;
}) {
  const t = useTranslations("soulCards");
  const isEn = locale === "en";
  const active = card.status === "active";

  return (
    <section className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {t("detail.certificate")}
        </h3>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            active
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          {active ? t("status.active") : t("status.burned")}
        </span>
      </div>

      {/* 凭证三要素 + 网络 */}
      <dl className="space-y-1.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-zinc-400">{t("certificate.tokenId")}</dt>
          <dd>#{card.tokenId}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-zinc-400">{t("certificate.certNo")}</dt>
          <dd>{card.certificateNo}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-zinc-400">{t("certificate.network")}</dt>
          <dd>
            {chain ? (
              <>
                {chain.provider.network}
                {chain.provider.isSimulated ? ` · ${t("simulatedBadge")}` : ""}
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-zinc-400">{t("certificate.contract")}</dt>
          <dd>{chain ? truncateHash(chain.provider.contractAddress) : "—"}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-zinc-400">{t("certificate.mintTx")}</dt>
          <dd>{truncateHash(card.mintTx)}</dd>
        </div>
        {card.burnTx ? (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-zinc-400">{t("certificate.burnTx")}</dt>
            <dd>{truncateHash(card.burnTx)}</dd>
          </div>
        ) : null}
      </dl>

      {/* 链上轨迹 */}
      <h4 className="mt-3 mb-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
        {t("certificate.ledger")}
      </h4>
      {ledger.length === 0 ? (
        <p className="text-[11px] text-zinc-400">{t("certificate.ledgerEmpty")}</p>
      ) : (
        <ol className="space-y-1.5">
          {ledger.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-2 py-1.5 text-[11px] dark:bg-zinc-800/60"
            >
              <span className="flex items-center gap-1.5">
                <span>{TX_TYPE_EMOJI[entry.txType]}</span>
                <span className="font-medium text-zinc-700 dark:text-zinc-200">
                  {t(`txType.${entry.txType}`)}
                </span>
                <span className="font-mono text-zinc-400">
                  {truncateHash(entry.txHash)}
                </span>
              </span>
              <span className="shrink-0 font-mono text-zinc-400">
                {isEn ? "block" : "区块"} {entry.blockNumber}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
