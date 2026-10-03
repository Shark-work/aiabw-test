"use client";

/**
 * NfrBreedModal · 繁育配对弹窗（2026-10-08 收藏中心 NFR 操作入口）
 *  - 亲本池：当前用户与该卡片同物种（speciesId）的全部确权实例（不限稀有度，
 *    与 /api/pets/breed 服务端同物种校验口径一致）；breedCooldownUntil > now 的个体
 *    置灰并显示倒计时，不可选；
 *  - 恰好选 2 只 → POST /api/pets/breed { parentIds }（Bearer + x-locale）；
 *  - 成功展示子代（稀有度徽章 / 世代 / 确权哈希）；402 积分不足给 /points 充值入口；
 *  - BREED_COST_POINTS 与 src/lib/genetics.ts BREED_COST 保持同步（契约测试锁定）。
 */
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { getRarityMeta } from "@/lib/pet-status";
import {
  formatRemaining,
  shortHash,
  useNow,
  type CollectibleInstance,
} from "@/components/collection/nfr-shared";

/** 与 src/lib/genetics.ts BREED_COST 保持同步（tests/nfr-actions.test.mjs 锁定） */
const BREED_COST_POINTS = 200;

export type NfrDefinitionLite = {
  id: string;
  speciesId: string;
  name: string;
  rarity: string;
  imageUrl: string;
};

type BreedNfr = {
  hashId: string;
  speciesName: string;
  generation: number;
  dna?: { rarity?: string };
};

export function NfrBreedModal({
  item,
  allInstances,
  onClose,
  onDone,
}: {
  item: NfrDefinitionLite;
  allInstances: CollectibleInstance[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("collection.nfr");
  const locale = useLocale();
  const isEn = locale === "en";
  const now = useNow();

  // 亲本池：同物种全部实例（服务端仅要求同物种，不限稀有度）
  const pool = allInstances.filter((i) => i.speciesId === item.speciesId);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState(0);
  const [child, setChild] = useState<BreedNfr | null>(null);

  function toggle(id: string, cooling: boolean) {
    if (cooling || busy) return;
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= 2
          ? [prev[1], id] // 已满 2 只：滚出最早选择，保持「恰好 2 只」
          : [...prev, id],
    );
  }

  async function submit() {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("aiabw_token") : null;
    if (!token || selected.length !== 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pets/breed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-locale": locale,
        },
        body: JSON.stringify({ parentIds: selected }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        nfr?: BreedNfr;
      };
      if (!res.ok || !data.ok) {
        setError(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
        setErrorStatus(res.status);
        return;
      }
      setChild(data.nfr ?? null);
    } catch {
      setError("network");
    } finally {
      setBusy(false);
    }
  }

  const childMeta = getRarityMeta(child?.dna?.rarity ?? item.rarity);


  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {child ? (
          <div className="space-y-4 text-center">
            <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
              {t("breed.success")}
            </p>
            <div className="mx-auto w-36 overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.imageUrl} alt={child.speciesName} className="aspect-square w-full object-contain" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                {child.speciesName}
                <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${childMeta.badgeClass}`}>
                  {childMeta.emoji} {isEn ? childMeta.labelEn : childMeta.labelZh}
                </span>
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("breed.childGen", { gen: child.generation })}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("breed.hash")}：
                <span className="font-mono">{shortHash(child.hashId)}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onDone}
              className="w-full rounded-full bg-violet-500 py-2 text-sm font-semibold text-white transition hover:bg-violet-600"
            >
              {t("common.done")}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <header>
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                🧬 {t("breed.title")} · {item.name}
              </h3>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {t("breed.hint")} · {t("breed.cost", { cost: BREED_COST_POINTS })}
              </p>
            </header>

            {pool.length < 2 ? (
              <p className="rounded-xl bg-zinc-50 p-4 text-center text-sm text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {t("breed.empty")}
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-2">
                {pool.map((inst) => {
                  const cooldownMs = new Date(inst.breedCooldownUntil).getTime() - now;
                  const cooling = cooldownMs > 0;
                  const active = selected.includes(inst.id);
                  const meta = getRarityMeta(inst.rarity);
                  return (
                    <li key={inst.id}>
                      <button
                        type="button"
                        disabled={cooling || busy}
                        onClick={() => toggle(inst.id, cooling)}
                        className={`w-full rounded-xl border p-2 text-left transition ${
                          active
                            ? "border-violet-500 bg-violet-50 ring-2 ring-violet-300 dark:bg-violet-950/40"
                            : "border-zinc-200 bg-white hover:border-violet-300 dark:border-zinc-700 dark:bg-zinc-900"
                        } ${cooling ? "cursor-not-allowed opacity-60" : ""}`}
                      >
                        <div className="flex items-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={inst.imageUrl} alt={inst.name} className="h-10 w-10 rounded-lg object-contain" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                              {inst.name}
                            </p>
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                              {meta.emoji} {t("breed.gen", { gen: inst.generation })} ·{" "}
                              <span className="font-mono">{shortHash(inst.hashId)}</span>
                            </p>
                          </div>
                          {active ? <span className="text-violet-500">✓</span> : null}
                        </div>
                        {cooling ? (
                          <p className="mt-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            ⏳ {t("breed.cooldown", { remaining: formatRemaining(cooldownMs, isEn) })}
                          </p>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {error ? (
              <div className="rounded-xl bg-red-50 p-3 text-center text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">
                <p>{error}</p>
                {errorStatus === 402 ? (
                  <Link href="/points" className="mt-1 inline-block font-semibold underline">
                    {t("breed.recharge")}
                  </Link>
                ) : null}
              </div>
            ) : null}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-full border border-zinc-200 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={selected.length !== 2 || busy}
                onClick={() => void submit()}
                className="flex-1 rounded-full bg-violet-500 py-2 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? t("breed.working") : selected.length !== 2 ? t("breed.needTwo") : t("breed.submit")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
