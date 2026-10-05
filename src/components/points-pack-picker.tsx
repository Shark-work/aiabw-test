"use client";

import { useTranslations } from "next-intl";

import {
  FIRST_PURCHASE_BONUS_MULTIPLIER,
  POINTS_PACKS,
  type PointsPack,
} from "@/lib/points-recharge";

type Props = {
  /** 是否可享首充双倍（true → 档位显示 ×2 到账 + 「首充×2」角标） */
  isFirstPurchase: boolean;
  onPick: (pack: PointsPack) => void;
  /** testid 前缀：档位按钮为 `<idPrefix>-<points>`，首充角标为 `<idPrefix>-first-badge` */
  idPrefix: string;
  /** 最低档显示「推荐」角标（首充特惠弹窗用） */
  showRecommended?: boolean;
};

/**
 * 充值档位网格（Phase 4 共享组件）：积分不足弹窗 / 首充特惠弹窗复用。
 * 价格与积分只读服务端档位表常量（POINTS_PACKS），首充倍率读 FIRST_PURCHASE_BONUS_MULTIPLIER。
 */
export function PointsPackPicker({
  isFirstPurchase,
  onPick,
  idPrefix,
  showRecommended = false,
}: Props) {
  const t = useTranslations("pointsEntry");
  const minPrice = Math.min(...POINTS_PACKS.map((p) => p.priceCny));
  return (
    <div className="grid grid-cols-2 gap-2">
      {POINTS_PACKS.map((p) => (
        <button
          key={p.points}
          type="button"
          data-testid={`${idPrefix}-${p.points}`}
          onClick={() => onPick(p)}
          className="relative rounded-xl border border-amber-200 bg-gradient-to-b from-amber-50 to-white px-2 py-3 text-center transition hover:border-amber-400 hover:shadow"
        >
          {isFirstPurchase && (
            <span
              data-testid={`${idPrefix}-first-badge`}
              className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-rose-500 to-orange-500 px-2 py-0.5 text-[10px] font-bold text-white shadow"
            >
              {t("firstBadge")}
            </span>
          )}
          {showRecommended && p.priceCny === minPrice && (
            <span
              data-testid={`${idPrefix}-recommended`}
              className="absolute -top-2 right-1 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow"
            >
              {t("recommended")}
            </span>
          )}
          <div className="text-base font-extrabold text-amber-600">
            {isFirstPurchase ? p.points * FIRST_PURCHASE_BONUS_MULTIPLIER : p.points}
          </div>
          {isFirstPurchase && (
            <div className="text-[10px] text-zinc-400 line-through">{p.points}</div>
          )}
          <div className="text-[11px] text-zinc-400">{t("packUnit")}</div>
          <div className="mt-1 text-sm font-semibold text-zinc-700">¥{p.priceCny}</div>
        </button>
      ))}
    </div>
  );
}
