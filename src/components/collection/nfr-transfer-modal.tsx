"use client";

/**
 * NfrTransferModal · 转赠弹窗（2026-10-08 收藏中心 NFR 操作入口）
 *  - 三步：选择个体（lockedUntil > now 置灰 + 倒计时）→ 输入接收方注册邮箱 →
 *    二次确认（不可撤销提示）→ POST /api/pets/transfer { collectibleId, toEmail }；
 *  - 服务端按邮箱解析接收者（receiverNotFound 404 / transferSelf 400），
 *    错误文案已由 API 按 x-locale 本地化，直接展示；
 *  - 成功后对方需 7 天冷却才能再次转赠（服务端 TRANSFER_COOLDOWN_MS 强制）。
 */
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { getRarityMeta } from "@/lib/pet-status";
import {
  formatRemaining,
  shortHash,
  useNow,
  type CollectibleInstance,
} from "@/components/collection/nfr-shared";
import type { NfrDefinitionLite } from "@/components/collection/nfr-breed-modal";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = "pick" | "confirm" | "done";

export function NfrTransferModal({
  item,
  instances,
  onClose,
  onDone,
}: {
  item: NfrDefinitionLite;
  /** 该藏品定义下当前用户持有的全部实例 */
  instances: CollectibleInstance[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("collection.nfr");
  const locale = useLocale();
  const isEn = locale === "en";
  const now = useNow();

  const [step, setStep] = useState<Step>("pick");
  const [instId, setInstId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = instances.find((i) => i.id === instId) ?? null;
  const emailOk = EMAIL_RE.test(email.trim());
  const meta = getRarityMeta(item.rarity);

  async function submit() {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("aiabw_token") : null;
    if (!token || !chosen || !emailOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pets/transfer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-locale": locale,
        },
        body: JSON.stringify({ collectibleId: chosen.id, toEmail: email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
        setStep("pick");
        return;
      }
      setStep("done");
    } catch {
      setError("network");
      setStep("pick");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {step === "done" ? (
          <div className="space-y-4 text-center">
            <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
              {t("transfer.success", { email: email.trim() })}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {item.name} · <span className="font-mono">{chosen ? shortHash(chosen.hashId) : ""}</span>
            </p>
            <button
              type="button"
              onClick={onDone}
              className="w-full rounded-full bg-violet-500 py-2 text-sm font-semibold text-white transition hover:bg-violet-600"
            >
              {t("common.done")}
            </button>
          </div>
        ) : step === "confirm" && chosen ? (
          <div className="space-y-4">
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              ⚠️ {t("transfer.confirmTitle")}
            </h3>
            <div className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.imageUrl} alt={item.name} className="h-14 w-14 rounded-lg object-contain" />
              <div className="min-w-0 flex-1 text-xs text-zinc-600 dark:text-zinc-300">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {item.name}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}>
                    {meta.emoji} {isEn ? meta.labelEn : meta.labelZh}
                  </span>
                </p>
                <p className="mt-0.5 font-mono">{shortHash(chosen.hashId)}</p>
              </div>
            </div>
            <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              {t("transfer.confirmDesc", {
                name: item.name,
                hash: shortHash(chosen.hashId),
                email: email.trim(),
              })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep("pick")}
                className="flex-1 rounded-full border border-zinc-200 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="flex-1 rounded-full bg-violet-500 py-2 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? t("transfer.working") : t("transfer.confirm")}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <header>
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                🎁 {t("transfer.title")} · {item.name}
              </h3>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("transfer.pick")}</p>
            </header>

            <ul className="space-y-2">
              {instances.map((inst) => {
                const cooldownMs = new Date(inst.lockedUntil).getTime() - now;
                const cooling = cooldownMs > 0;
                const active = instId === inst.id;
                return (
                  <li key={inst.id}>
                    <button
                      type="button"
                      disabled={cooling || busy}
                      onClick={() => setInstId(active ? null : inst.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition ${
                        active
                          ? "border-violet-500 bg-violet-50 ring-2 ring-violet-300 dark:bg-violet-950/40"
                          : "border-zinc-200 bg-white hover:border-violet-300 dark:border-zinc-700 dark:bg-zinc-900"
                      } ${cooling ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={inst.imageUrl} alt={inst.name} className="h-10 w-10 rounded-lg object-contain" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-zinc-600 dark:text-zinc-300">
                          {t("breed.gen", { gen: inst.generation })} ·{" "}
                          <span className="font-mono">{shortHash(inst.hashId)}</span>
                        </p>
                        {cooling ? (
                          <p className="mt-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            ⏳ {t("transfer.cooldown", { remaining: formatRemaining(cooldownMs, isEn) })}
                          </p>
                        ) : null}
                      </div>
                      {active ? <span className="text-violet-500">✓</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                {t("transfer.emailLabel")}
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("transfer.emailPlaceholder")}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
              />
            </label>

            {error ? (
              <p className="rounded-xl bg-red-50 p-3 text-center text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">
                {error}
              </p>
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
                disabled={!chosen || !emailOk || busy}
                onClick={() => setStep("confirm")}
                className="flex-1 rounded-full bg-violet-500 py-2 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("transfer.next")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
