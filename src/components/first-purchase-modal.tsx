"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { PointsPackPicker } from "@/components/points-pack-picker";
import { PointsRechargeModal } from "@/components/points-recharge-modal";
import { FIRST_PURCHASE_BONUS_MULTIPLIER, type PointsPack } from "@/lib/points-recharge";

type Props = {
  open: boolean;
  /** 本次操作所需积分（差额提示文案，可选） */
  needed?: number;
  /** 充值到账判定基线（弹窗打开时的积分余额） */
  baselinePoints: number;
  onClose: () => void;
  onCredited?: (pointsAfter: number) => void;
};

/**
 * 首充特惠弹窗（产品升级 Phase 4）：未首充用户首次积分不足时由 PointsRechargeHost 弹起。
 * 英雄区强调「全场档位双倍积分，仅限一次」；档位全部 ×2 标注（最低档「推荐」）。
 * 双倍真实性由 pay/notify 首充 CTE 保证（first_purchase 表 + first_purchase_bonus 流水）。
 */
export function FirstPurchaseModal({ open, needed, baselinePoints, onClose, onCredited }: Props) {
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
        data-testid="first-purchase-modal"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 英雄区：首充双倍横幅 */}
        <div className="rounded-2xl bg-gradient-to-r from-rose-500 via-orange-500 to-amber-500 p-4 text-center text-white shadow">
          <div className="text-3xl" aria-hidden>
            🎁
          </div>
          <h2 className="mt-1 text-lg font-extrabold">{t("firstTitle")}</h2>
          <p className="mt-1 text-xs text-white/90">
            {t("firstSubtitle", { multiplier: FIRST_PURCHASE_BONUS_MULTIPLIER })}
          </p>
          {needed && needed > 0 ? (
            <p className="mt-1 text-[11px] text-white/80">{t("insufficientNeeded", { needed })}</p>
          ) : null}
        </div>
        <div className="mt-4">
          <PointsPackPicker
            isFirstPurchase
            onPick={setPack}
            idPrefix="first-pack"
            showRecommended
          />
        </div>
        <p className="mt-2 text-center text-[11px] text-zinc-400">{t("firstNote")}</p>
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
