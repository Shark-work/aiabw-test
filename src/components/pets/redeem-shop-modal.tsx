"use client";

import { useTranslations } from "next-intl";

import { PetAvatar } from "@/components/PetAvatar";
import { PetWatermark } from "@/components/pets/pet-watermark";

const REDEEM_PRICE = 500;

/**
 * 积分兑换所（心理学激励）：
 *  - 盲盒：必得 Common，小概率 Uncommon，500 积分；
 *  - 进度条：积分不足不置灰，显示「还差 XX 分」利用损失厌恶促活；
 *  - 兑换成功 → 展示宠物 + 「存入我的宠物」闭环。
 */
export function RedeemShopModal({
  points,
  redeeming,
  redeemMsg,
  redeemResult,
  onRedeem,
  onDeposit,
  onClose,
}: {
  points: number;
  redeeming: boolean;
  redeemMsg: string;
  redeemResult: { id: string; speciesName: string; imageUrl: string; traits: { rarity?: string } } | null;
  onRedeem: () => void;
  onDeposit: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("petsCatalog");
  const tp = useTranslations("points");
  const tc = useTranslations("common");
  const need = Math.max(0, REDEEM_PRICE - points);
  const pct = Math.min(100, (points / REDEEM_PRICE) * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/50 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-3xl border border-zinc-200 bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-zinc-900">{t("redeemShop")}</h3>
            <p className="mt-0.5 text-xs text-zinc-500">{t("redeemBlindHint")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
            aria-label={tc("close")}
          >
            ×
          </button>
        </div>

        {/* 兑换结果（成功后展示 + 闭环按钮） */}
        {redeemResult ? (
          <div className="text-center">
            <div className="evolve-glow relative mx-auto rounded-full bg-violet-50">
              <PetAvatar
                src={redeemResult.imageUrl}
                alt={redeemResult.speciesName}
                className="born-pop h-28 w-28 rounded-full border-4 border-violet-300 object-cover shadow-xl"
              />
              <PetWatermark />
            </div>
            <p className="mt-2 text-sm font-semibold text-zinc-800">{redeemResult.speciesName}</p>
            <p className="font-mono text-[11px] text-zinc-400">{redeemResult.id}</p>
            {redeemMsg && <p className="mt-1 text-xs font-medium text-emerald-700">{redeemMsg}</p>}
            <button
              type="button"
              onClick={onDeposit}
              className="mt-3 w-full rounded-full bg-violet-500 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-600"
            >
              {t("deposit")}
            </button>
          </div>
        ) : (
          <>
            {/* 价格 + 进度条（越接近越兴奋，不足不置灰） */}
            <div className="flex justify-between text-[11px] text-zinc-500">
              <span>
                {tp("redeemPrice")}: {REDEEM_PRICE} ⭐
              </span>
              <span>
                {points} / {REDEEM_PRICE} ⭐
              </span>
            </div>
            <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-violet-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] font-medium text-violet-700">
              {need > 0 ? t("redeemNeed", { need }) : tp("redeemProgressReady")}
            </p>

            {redeemMsg && (
              <p className={`mt-2 text-xs font-medium ${redeemMsg.includes("🎉") ? "text-emerald-700" : "text-red-600"}`}>
                {redeemMsg}
              </p>
            )}

            <button
              type="button"
              onClick={onRedeem}
              disabled={redeeming}
              className="mt-3 w-full rounded-full bg-violet-500 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:opacity-50"
            >
              {redeeming ? tp("redeeming") : tp("redeemBtn")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
