"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { PayQr } from "@/components/pay-qr";

export type PaymentMethod = "points" | "wechat";

type Props = {
  open: boolean;
  title: string;
  /** 人民币金额（元） */
  amount: number;
  /** 积分等价（可选，>0 时展示「或 X 积分」） */
  pointsCost?: number;
  description?: string;
  /** 微信支付二维码（有值时展示扫码区） */
  qr?: string;
  payUrl?: string | null;
  /** 等待支付确认中（轮询） */
  pending?: boolean;
  /** 下单生成二维码中 */
  busy?: boolean;
  error?: string;
  /** 用户确认选择支付方式 */
  onPay?: (method: PaymentMethod) => void;
  onClose: () => void;
};

/**
 * 全局通用支付弹窗（统一交互）：
 *  - 金额大展示 + 支付方式选择（积分 / 微信支付）；
 *  - 微信扫码区（PayQr）+ 打开收银台 + 等待确认态；
 *  - 「✕」关闭图标 + 底部「取消支付」按钮，样式全站一致。
 */
export function PaymentModal({
  open,
  title,
  amount,
  pointsCost,
  description,
  qr,
  payUrl,
  pending,
  busy,
  error,
  onPay,
  onClose,
}: Props) {
  const t = useTranslations("pay");
  const tc = useTranslations("common");
  const [method, setMethod] = useState<PaymentMethod>("wechat");

  if (!open) return null;

  const showWechat = !!qr || !!payUrl;
  const showPoints = pointsCost != null && pointsCost > 0;

  const selectMethod = (m: PaymentMethod) => {
    setMethod(m);
    onPay?.(m);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ✕ 关闭图标 */}
        <button
          type="button"
          onClick={onClose}
          aria-label={tc("close")}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
        >
          ✕
        </button>

        <h3 className="pr-8 text-lg font-bold text-zinc-900">{title}</h3>
        {description && <p className="mt-1 text-xs text-zinc-500">{description}</p>}

        {/* 金额展示 */}
        <div className="mt-4 rounded-xl bg-gradient-to-r from-orange-50 to-amber-50 p-4 text-center">
          <div className="text-xs text-zinc-500">{t("payAmount")}</div>
          <div className="mt-1 text-3xl font-extrabold text-orange-600">¥{amount.toFixed(2)}</div>
          {showPoints && <div className="mt-1 text-xs text-zinc-400">{t("orPoints", { points: pointsCost })}</div>}
        </div>

        {/* 支付方式选择 */}
        {(showWechat || showPoints) && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold text-zinc-500">{t("payMethod")}</div>
            <div className="grid grid-cols-2 gap-2">
              {showPoints && (
                <button
                  type="button"
                  onClick={() => selectMethod("points")}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                    method === "points"
                      ? "border-orange-400 bg-orange-50 text-orange-600"
                      : "border-zinc-200 text-zinc-600 hover:border-orange-300"
                  }`}
                >
                  ⭐ {t("pointsMethod")}
                </button>
              )}
              <button
                type="button"
                onClick={() => selectMethod("wechat")}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                  method === "wechat"
                    ? "border-emerald-400 bg-emerald-50 text-emerald-600"
                    : "border-zinc-200 text-zinc-600 hover:border-emerald-300"
                }`}
              >
                💚 {t("wechatMethod")}
              </button>
            </div>
          </div>
        )}

        {/* 微信扫码区 */}
        {qr ? (
          <div className="mt-4 flex flex-col items-center gap-2">
            <PayQr value={qr} size={190} />
            {pending ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                {t("payWaiting")}
              </p>
            ) : (
              <p className="text-xs text-zinc-400">{t("scanHint")}</p>
            )}
            {payUrl && (
              <a
                href={payUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-emerald-600"
              >
                {t("openCashier")}
              </a>
            )}
          </div>
        ) : null}

        {busy && (
          <p className="mt-4 flex items-center justify-center gap-2 py-2 text-sm text-zinc-500">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
            {t("generatingQr")}
          </p>
        )}

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        {/* 取消支付 */}
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-full bg-zinc-100 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-200"
        >
          {t("cancelPay")}
        </button>
      </div>
    </div>
  );
}
