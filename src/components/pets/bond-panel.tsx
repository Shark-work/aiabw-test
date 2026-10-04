"use client";

/**
 * 灵宠「羁绊」区块（/pets/my 伙伴详情区内，P1 故事外显 · 改动三）：
 *  - 展示当前灵宠与同物种灵宠的羁绊值（bond-config：共同探索 + 双向陪伴 + 双向互动）；
 *  - 羁绊达标（BOND_UNLOCK_THRESHOLD）且双方不在沉淀期 → 解锁「结晶」；
 *  - 结晶：POST /api/pets/breed（复用现有接口）→ 双奖励弹窗
 *    （结晶灵宠 + 羁绊结晶藏品 hashId + 灵魂凭证编号，编号来自 breed 自动铸卡）。
 *
 * 数据源 GET /api/pets/[adoptionId]/bonds；无同物种候选时展示引导文案。
 * 叙事约束：全区块使用「羁绊 / 共鸣 / 结晶灵宠」表述（违禁词由 tests/bond-crystal.test.mjs 锁定）。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { BOND_SCORE_MAX, BOND_UNLOCK_THRESHOLD } from "@/lib/bond-config";

type Partner = {
  petId: string;
  collectibleId: string;
  petName: string;
  imageUrl: string | null;
  happiness: number;
  bondScore: number;
  unlocked: boolean;
  cooldownUntil: string | null;
  inCooldown: boolean;
};

type BondsData = {
  me: { collectibleId: string; petName: string; inCooldown: boolean };
  breedCost: number;
  partners: Partner[];
};

type CrystalResult = {
  petName: string;
  hashId: string;
  generation: number;
  certificateNo: string | null;
};

/** 冷却剩余格式化：>1d → "Xd Yh"，否则 "Xh Ym"。 */
function formatCooldown(until: string | null): string {
  if (!until) return "";
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return "";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.ceil((ms % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

export function BondPanel({ adoptionId }: { adoptionId: string }) {
  const t = useTranslations("myPets.bond");
  const [data, setData] = useState<BondsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<Partner | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CrystalResult | null>(null);

  const load = useCallback(async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/pets/${adoptionId}/bonds`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) setData(d as BondsData);
    } catch {
      /* 羁绊区拉取失败不影响详情主体 */
    } finally {
      setLoading(false);
    }
  }, [adoptionId]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setResult(null);
    void load();
  }, [load]);

  /** 结晶（复用 /api/pets/breed；成功后弹双奖励 + 刷新羁绊/冷却）。 */
  async function crystallize() {
    if (!confirm || !data || working) return;
    setWorking(true);
    setError("");
    try {
      const res = await fetch("/api/pets/breed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("aiabw_token") ?? ""}`,
        },
        body: JSON.stringify({
          parentIds: [data.me.collectibleId, confirm.collectibleId],
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setError(d?.error ?? t("failed"));
        return;
      }
      setResult({
        petName: String(d.nfr?.speciesName ?? ""),
        hashId: String(d.nfr?.hashId ?? ""),
        generation: Number(d.nfr?.generation ?? 1),
        certificateNo: d.soulCard?.certificateNo
          ? String(d.soulCard.certificateNo)
          : null,
      });
      setConfirm(null);
      void load();
    } catch {
      setError(t("failed"));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-500">{t("title")}</span>
        <span className="text-[10px] text-zinc-400">
          {t("thresholdHint", { threshold: BOND_UNLOCK_THRESHOLD })}
        </span>
      </div>

      {loading ? (
        <p className="py-2 text-center text-xs text-zinc-400">{t("loading")}</p>
      ) : !data || data.partners.length === 0 ? (
        <p className="rounded-xl bg-zinc-50 px-3 py-2.5 text-center text-xs text-zinc-400 dark:bg-zinc-800/60">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {data.partners.map((p) => {
            const ready = p.unlocked && !p.inCooldown && !data.me.inCooldown;
            return (
              <li
                key={p.collectibleId}
                className="flex items-center gap-2.5 rounded-xl border border-zinc-100 bg-zinc-50/60 px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-800/40"
              >
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.imageUrl}
                    alt={p.petName}
                    className="h-9 w-9 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-base dark:bg-violet-900/40">
                    🐾
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-200">
                      {p.petName}
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-400">
                      {t("scoreLabel")} {p.bondScore}/{BOND_SCORE_MAX}
                    </span>
                  </div>
                  {/* 羁绊进度条 */}
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200/70 dark:bg-zinc-700/60">
                    <div
                      className={`h-full rounded-full transition-all ${
                        p.unlocked
                          ? "bg-gradient-to-r from-violet-500 to-fuchsia-400"
                          : "bg-zinc-400"
                      }`}
                      style={{ width: `${p.bondScore}%` }}
                    />
                  </div>
                </div>
                {p.inCooldown ? (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    ⏳ {t("cooldown")} {formatCooldown(p.cooldownUntil)}
                  </span>
                ) : ready ? (
                  <button
                    type="button"
                    onClick={() => setConfirm(p)}
                    className="shrink-0 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 px-2.5 py-1 text-[10px] font-semibold text-white transition hover:from-violet-700 hover:to-fuchsia-600"
                  >
                    {t("crystalCta")}
                  </button>
                ) : (
                  <span
                    className="shrink-0 rounded-full bg-zinc-200/80 px-2 py-1 text-[10px] text-zinc-400 dark:bg-zinc-700/60"
                    title={t("lockedHint")}
                  >
                    {t("unlocked")} · {BOND_UNLOCK_THRESHOLD}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!loading && data && data.partners.length > 0 ? (
        <p className="mt-1.5 text-[10px] text-zinc-400">{t("lockedHint")}</p>
      ) : null}
      {error ? <p className="mt-1.5 text-[11px] text-red-500">{error}</p> : null}


      {/* 二次确认弹窗 */}
      {confirm && data ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !working && setConfirm(null)}
        >
          <div
            className="w-full max-w-xs space-y-3 rounded-2xl bg-white p-4 shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-center text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {t("confirmTitle")}
            </h3>
            <p className="text-center text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {t("confirmDesc", { cost: data.breedCost, partner: confirm.petName })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={crystallize}
                disabled={working}
                className="flex-1 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 py-2 text-xs font-semibold text-white transition hover:from-violet-700 disabled:opacity-60"
              >
                {working ? t("working") : t("confirmOk")}
              </button>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={working}
                className="flex-1 rounded-full border border-zinc-300 py-2 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t("confirmCancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 双奖励弹窗：结晶灵宠 + 羁绊结晶藏品（+ 灵魂凭证编号） */}
      {result ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setResult(null)}
        >
          <div
            className="w-full max-w-xs space-y-3 rounded-2xl bg-white p-4 text-center shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-3xl" aria-hidden>
              💎
            </div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {t("successTitle")}
            </h3>
            <div className="space-y-1.5 text-left">
              <p className="rounded-lg bg-violet-50 px-2.5 py-1.5 text-[11px] text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                🐣 {t("newPet")} · {result.petName}（Gen {result.generation}）
              </p>
              <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 font-mono text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                🏵️ {t("newNfr")} · #{result.hashId.slice(0, 12)}
              </p>
              {result.certificateNo ? (
                <p className="rounded-lg bg-emerald-50 px-2.5 py-1.5 font-mono text-[11px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  📜 {t("certNo")} · {result.certificateNo}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="w-full rounded-full bg-violet-600 py-2 text-xs font-semibold text-white transition hover:bg-violet-700"
            >
              {t("confirmCancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

