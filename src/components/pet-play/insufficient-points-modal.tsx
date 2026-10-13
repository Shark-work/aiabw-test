"use client";

import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";

interface InsufficientPointsModalProps {
  /** i18n 命名空间（"petPlay" | "petMovie"——两页文案键一致） */
  ns: string;
  open: boolean;
  /** 当前余额（402 响应带回，弹窗内展示） */
  points: number;
  onClose: () => void;
}

/**
 * 积分不足引导弹窗（需求五.1：余额不足弹窗引导充值/会员，不再一行 toast 静默带过）。
 * 触发点：/api/pet/chat 402（超出每日免费后余额不足）、/api/pet/play/buy 402。
 */
export function InsufficientPointsModal({ ns, open, points, onClose }: InsufficientPointsModalProps) {
  const t = useTranslations(ns);
  const router = useRouter();
  if (!open) return null;
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t("rechargeTitle")}
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 p-6 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-4xl">🪙</div>
        <h3 className="mt-3 text-lg font-semibold text-white">{t("rechargeTitle")}</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          {t("rechargeDesc", { points })}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => router.push("/pay")}
            className="w-full rounded-full bg-amber-400 py-2.5 text-sm font-semibold text-black transition hover:bg-amber-300"
          >
            {t("goRecharge")}
          </button>
          <button
            type="button"
            onClick={() => router.push("/checkin")}
            className="w-full rounded-full bg-white/10 py-2.5 text-sm font-medium text-white transition hover:bg-white/20"
          >
            {t("goCheckin")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mt-1 text-xs text-white/40 transition hover:text-white/70"
          >
            {t("cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
