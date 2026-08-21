"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { usePathname } from "@/i18n/navigation";

const SUPPORT_EMAIL = "1206309834@qq.com";
const QQ_GROUP = "1005445619";

/**
 * 右下角悬浮客服按钮（高转化兜底）：
 *  - fixed bottom-6 right-6，z-40（高于普通内容、低于 z-50 弹窗）；
 *  - /chat 全屏聊天页自动隐藏，避免遮挡聊天界面；
 *  - 点击展开轻量面板：QQ 邮箱（一键复制）+ QQ 群号；
 *  - 移动端按钮缩小，不遮挡核心内容。
 */
export function FloatingSupport() {
  const t = useTranslations("support");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // 聊天页（全屏）隐藏悬浮客服
  const hidden = pathname.startsWith("/chat");
  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时静默（用户仍可手动复制）
    }
  };

  if (hidden) return null;

  return (
    <div className="fixed bottom-6 right-6 z-40">
      {open && (
        <div className="absolute bottom-16 right-0 w-64 rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl">
          <p className="text-sm font-bold text-zinc-900">🎧 {t("supportTitle")}</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">{t("supportBody")}</p>
          <div className="mt-3 space-y-2">
            {/* QQ 邮箱（一键复制） */}
            <div className="flex items-center justify-between gap-2 rounded-xl bg-orange-50 px-3 py-2">
              <span className="min-w-0">
                <span className="block text-[10px] text-zinc-400">{t("supportEmail")}</span>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="break-all text-xs font-medium text-orange-600 hover:underline"
                >
                  {SUPPORT_EMAIL}
                </a>
              </span>
              <button
                type="button"
                onClick={() => void copyEmail()}
                className="shrink-0 rounded-full bg-orange-500 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-orange-600"
              >
                {copied ? t("copied") : t("copy")}
              </button>
            </div>
            {/* QQ 群号 */}
            <div className="rounded-xl bg-zinc-50 px-3 py-2">
              <span className="block text-[10px] text-zinc-400">{t("supportQQGroup")}</span>
              <span className="font-mono text-sm font-semibold text-zinc-700">{QQ_GROUP}</span>
            </div>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("supportTitle")}
        aria-expanded={open}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-rose-400 text-xl text-white shadow-lg transition hover:scale-105 md:h-14 md:w-14"
      >
        {open ? "✕" : "🎧"}
      </button>
    </div>
  );
}
