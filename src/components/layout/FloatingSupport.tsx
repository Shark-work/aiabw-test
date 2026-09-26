"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { usePathname } from "@/i18n/navigation";
import { MailIcon, QQIcon, XIcon } from "@/components/social-icons";
import { CONTACT_INFO, EMAIL_URL, QQ_SERVICE_URL } from "@/lib/config";

/**
 * 右下角悬浮客服按钮（高转化兜底）：
 *  - fixed bottom-6 right-6，z-40（高于普通内容、低于 z-50 弹窗）；
 *  - /chat 全屏聊天页自动隐藏，避免遮挡聊天界面；
 *  - 点击展开轻量面板：QQ群 + 客服QQ + X (Twitter) + 官方邮箱（CONTACT_INFO 统一渠道）；
 *  - 移动端按钮缩小，不遮挡核心内容。
 */
export function FloatingSupport() {
  const t = useTranslations("support");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // 聊天页（全屏）隐藏悬浮客服
  const hidden = pathname.startsWith("/chat");
  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);

  if (hidden) return null;

  return (
    <div className="fixed bottom-6 right-6 z-40">
      {open && (
        <div className="absolute bottom-16 right-0 w-64 rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl">
          <p className="text-sm font-bold text-zinc-900">🎧 {t("supportTitle")}</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">{t("supportBody")}</p>
          <div className="mt-3 space-y-2">
            {/* QQ 群（搜索群号加入，无在线链接） */}
            <div
              className="flex items-center justify-between gap-2 rounded-xl bg-sky-50 px-3 py-2.5"
              title={t("socialQqGroupHint")}
            >
              <span className="flex items-center gap-2 text-xs font-medium text-zinc-700">
                <QQIcon className="h-4 w-4 text-[#12B7F5]" />
                {t("socialQqGroup")}
              </span>
              <span className="text-[10px] text-zinc-400">{t("socialQqGroupHint")}</span>
            </div>
            {/* 客服 QQ（一键唤起会话） */}
            <a
              href={QQ_SERVICE_URL}
              className="flex items-center justify-between gap-2 rounded-xl bg-sky-50 px-3 py-2.5 transition hover:bg-sky-100"
            >
              <span className="flex items-center gap-2 text-xs font-medium text-zinc-700">
                <QQIcon className="h-4 w-4 text-[#12B7F5]" />
                {t("socialQqService")}
              </span>
              <span className="text-[10px] text-zinc-400">↗</span>
            </a>
            {/* X (Twitter) */}
            <a
              href={CONTACT_INFO.xUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2.5 transition hover:bg-zinc-100"
            >
              <span className="flex items-center gap-2 text-xs font-medium text-zinc-700">
                <XIcon className="h-4 w-4 text-zinc-800" />
                {t("socialX")}
              </span>
              <span className="text-[10px] text-zinc-400">↗</span>
            </a>
            {/* 官方邮箱 */}
            <a
              href={EMAIL_URL}
              className="flex items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2.5 transition hover:bg-zinc-100"
            >
              <span className="flex items-center gap-2 text-xs font-medium text-zinc-700">
                <MailIcon className="h-4 w-4 text-zinc-800" />
                {t("socialEmail")}
              </span>
              <span className="text-[10px] text-zinc-400">↗</span>
            </a>
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
