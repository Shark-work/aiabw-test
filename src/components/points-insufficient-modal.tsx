"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { PointsPackPicker } from "@/components/points-pack-picker";
import { PointsRechargeModal } from "@/components/points-recharge-modal";
import type { PointsPack } from "@/lib/points-recharge";

type Props = {
  open: boolean;
  /** 本次操作所需积分（差额提示文案，可选） */
  needed?: number;
  /** 是否可享首充双倍（档位 ×2 标签） */
  isFirstPurchase: boolean;
  /** 充值到账判定基线（弹窗打开时的积分余额） */
  baselinePoints: number;
  onClose: () => void;
  onCredited?: (pointsAfter: number) => void;
};

/**
 * 积分不足充值引导弹窗（产品升级 Phase 4）：
 * 402 / 积分不足场景由 PointsRechargeHost 经事件总线弹起；
 * 档位网格（首充用户带 ×2 标签）→ 内嵌 PointsRechargeModal 扫码支付 → 到账回传关闭。
 * 选档后底层隐藏（state 保留），支付弹窗关闭后回来可重新选档。
 */
export function PointsInsufficientModal({
  open,
  needed,
  isFirstPurchase,
  baselinePoints,
  onClose,
  onCredited,
}: Props) {
  const t = useTranslations("pointsEntry");
  const [pack, setPack] = useState<PointsPack | null>(null);

  if (!open) return null;

  if (pack) {
    return (
      <PointsRechargeModal
        open
        pack={pack}
        baselinePoints={baselinePoints}
        onClose={() => setPack(null)}
        onCredited={(after) => {
          setPack(null);
          onCredited?.(after);
        }}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        data-testid="points-insufficient-modal"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center">
          <div className="text-3xl" aria-hidden>
            🪙
          </div>
          <h2 className="mt-1 text-lg font-bold text-zinc-900">{t("insufficientTitle")}</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {needed && needed > 0 ? t("insufficientNeeded", { needed }) : t("insufficientBody")}
          </p>
        </div>
        <div className="mt-4">
          <PointsPackPicker
            isFirstPurchase={isFirstPurchase}
            onPick={setPack}
            idPrefix="insufficient-pack"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-full border border-zinc-200 px-3 py-2 text-xs text-zinc-500 transition hover:bg-zinc-50"
        >
          {t("later")}
        </button>
      </div>
    </div>
  );
}
