"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { LivingPet } from "@/components/LivingPet";
import { notifyPointsInsufficient } from "@/lib/points-entry";
import { getRarityMeta } from "@/lib/pet-status";

type Target = {
  id: string;
  name: string;
  rarity: string;
  element: string | null;
  generation: number;
  hashId: string;
  imageUrl: string;
  promoting: boolean;
  /** Phase 6：生效推广的到期时间（提前下架入口展示用；非推广中为 null） */
  promotionEndTime: string | null;
};
type Pricing = { days: number; cost: number };

/**
 * 付费推荐位购买弹窗（产品升级 Phase 5）：
 *  - 选择持有的藏品实例 + 推广时长（1/3/7 天），积分支付；
 *  - 402 积分不足 → 复用 Phase 4 事件总线 notifyPointsInsufficient 拉起充值引导；
 *  - 409 already_promoted → 提示并刷新目标列表（该藏品置灰）。
 */
export function PromoteModal({
  open,
  initialContentId,
  onClose,
  onPromoted,
}: {
  open: boolean;
  initialContentId?: string | null;
  onClose: () => void;
  onPromoted: () => void;
}) {
  const t = useTranslations("promote");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [targets, setTargets] = useState<Target[]>([]);
  const [pricing, setPricing] = useState<Pricing[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [days, setDays] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgKind, setMsgKind] = useState<"info" | "ok" | "err">("info");

  const load = useCallback(async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) {
      setMsg(t("signInRequired"));
      setMsgKind("err");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/content/promote", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const d = await res.json().catch(() => null);
      if (d?.ok) {
        const items: Target[] = d.items ?? [];
        setTargets(items);
        setPricing(d.pricing ?? []);
        const pre = items.find((x) => x.id === initialContentId && !x.promoting);
        const first = items.find((x) => !x.promoting);
        setSelected(pre?.id ?? first?.id ?? "");
        setDays(d.pricing?.[0]?.days ?? 1);
      } else {
        setMsg(d?.error ?? t("loadFailed"));
        setMsgKind("err");
      }
    } catch {
      setMsg(t("loadFailed"));
      setMsgKind("err");
    } finally {
      setLoading(false);
    }
  }, [initialContentId, t]);

  useEffect(() => {
    if (open) {
      setMsg("");
      void load();
    }
  }, [open, load]);

  if (!open) return null;

  const cost = pricing.find((p) => p.days === days)?.cost ?? 0;
  const selectedTarget = targets.find((x) => x.id === selected);

  /** Phase 6 提前下架：确认后 DELETE，结束生效推广（不退积分，接口幂等） */
  const endPromotion = async (contentId: string) => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    if (!window.confirm(t("endConfirm"))) return;
    try {
      const res = await fetch("/api/content/promote", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ contentId }),
      });
      const d = await res.json().catch(() => null);
      if (d?.ok) {
        setMsg(t("endDone"));
        setMsgKind("ok");
        if (selected === contentId) setSelected("");
        await load();
        onPromoted(); // 通知父组件刷新榜单推荐位
      } else {
        setMsg(d?.error ?? t("endFailed"));
        setMsgKind("err");
      }
    } catch {
      setMsg(t("endFailed"));
      setMsgKind("err");
    }
  };

  const submit = async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token || !selected) return;
    setSubmitting(true);
    setMsg("");
    try {
      const res = await fetch("/api/content/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ contentId: selected, days }),
      });
      const d = await res.json().catch(() => null);
      if (res.status === 402) {
        // 复用 Phase 4 积分不足事件总线（Host 统一拉起充值入口）
        notifyPointsInsufficient({ needed: Number(d?.needed ?? cost) });
        setMsg(t("insufficient"));
        setMsgKind("err");
        return;
      }
      if (res.status === 409 || d?.error === "already_promoted") {
        setMsg(t("alreadyPromoted"));
        setMsgKind("err");
        void load();
        return;
      }
      if (res.ok && d?.ok) {
        setMsg(
          t("success", {
            end: new Date(d.promotion.endTime).toLocaleString(locale === "en" ? "en-US" : "zh-CN"),
          }),
        );
        setMsgKind("ok");
        onPromoted();
        void load();
        return;
      }
      setMsg(d?.error ?? t("failed"));
      setMsgKind("err");
    } catch {
      setMsg(tc("networkError"));
      setMsgKind("err");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="promote-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-base font-bold text-zinc-800">📣 {t("title")}</h3>
          <button
            type="button"
            data-testid="promote-close"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-100"
          >
            ✕ {tc("close")}
          </button>
        </div>
        <p className="mb-4 text-xs text-zinc-500">{t("subtitle")}</p>

        {loading && <p className="py-8 text-center text-sm text-zinc-400">{tc("loading")}</p>}

        {!loading && targets.length === 0 && !msg && (
          <p className="py-8 text-center text-sm text-zinc-400">{t("noPets")}</p>
        )}

        {!loading && targets.length > 0 && (
          <>
            <p className="mb-2 text-xs font-semibold text-zinc-600">{t("selectPet")}</p>
            <div className="mb-4 grid max-h-56 grid-cols-3 gap-2 overflow-y-auto pr-1">
              {targets.map((pet) => {
                const meta = getRarityMeta(pet.rarity);
                const active = selected === pet.id;
                return (
                  <button
                    key={pet.id}
                    type="button"
                    data-testid={`promote-target-${pet.id}`}
                    disabled={pet.promoting}
                    onClick={() => setSelected(pet.id)}
                    className={`relative rounded-xl border p-2 text-left transition ${
                      active
                        ? "border-orange-400 bg-orange-50 shadow"
                        : "border-zinc-200 bg-white hover:border-orange-200"
                    } ${pet.promoting ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    <LivingPet
                      src={pet.imageUrl}
                      alt={pet.name}
                      tail={false}
                      className="mx-auto h-12 w-12 rounded-full border border-orange-100 bg-orange-50 object-cover"
                    />
                    <p className="mt-1 truncate text-center text-xs font-semibold text-zinc-700">{pet.name}</p>
                    <p className="text-center text-[10px] text-zinc-400">
                      {meta.emoji} ×{pet.generation}
                    </p>
                    {pet.promoting && (
                      <span
                        role="button"
                        tabIndex={-1}
                        data-testid={`promote-end-${pet.id}`}
                        title={t("endEarly")}
                        onClick={(e) => {
                          e.stopPropagation();
                          void endPromotion(pet.id);
                        }}
                        className="absolute right-1 top-1 cursor-pointer rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600 transition hover:bg-red-100 hover:text-red-600"
                      >
                        {t("promoting")} · ⏹
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <p className="mb-2 text-xs font-semibold text-zinc-600">{t("daysLabel")}</p>
            <div className="mb-4 flex gap-2">
              {pricing.map((p) => (
                <button
                  key={p.days}
                  type="button"
                  data-testid={`promote-days-${p.days}`}
                  onClick={() => setDays(p.days)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-center transition ${
                    days === p.days
                      ? "border-orange-400 bg-orange-50 shadow"
                      : "border-zinc-200 bg-white hover:border-orange-200"
                  }`}
                >
                  <div className="text-sm font-bold text-zinc-800">{t("days", { n: p.days })}</div>
                  <div className="text-xs font-semibold text-orange-600">{t("cost", { cost: p.cost })}</div>
                </button>
              ))}
            </div>

            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              💡 {t("note", { slots: 3 })}
            </p>
          </>
        )}

        {msg && (
          <p
            data-testid="promote-msg"
            className={`mb-3 rounded-lg px-3 py-2 text-xs ${
              msgKind === "ok"
                ? "bg-emerald-50 text-emerald-700"
                : msgKind === "err"
                  ? "bg-red-50 text-red-600"
                  : "bg-zinc-50 text-zinc-600"
            }`}
          >
            {msg}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-500 hover:bg-zinc-50"
          >
            {tc("cancel")}
          </button>
          <button
            type="button"
            data-testid="promote-confirm"
            disabled={submitting || !selected || !selectedTarget || selectedTarget.promoting}
            onClick={() => void submit()}
            className="flex-1 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white shadow hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? t("confirming") : `${t("confirm")} · ${t("cost", { cost })}`}
          </button>
        </div>
      </div>
    </div>
  );
}
