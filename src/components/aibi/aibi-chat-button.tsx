"use client";

/**
 * AibiChatButton · Aibi ↔ 聊天入口按钮（方案 a，背包卡片 / 详情页共用）
 *  - 已有 threadId → 直接跳 /chat?thread=<id>；
 *  - 无 threadId（老数据）→ POST /api/threads 幂等创建并关联后跳转（文案「创建聊天」）；
 *  - 401（未登录）→ 跳登录页并回跳当前页；其它失败恢复可点击（幂等可重试）。
 */
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { aibiFetch, AibiClientError } from "@/lib/aibi-client";

export function AibiChatButton({
  aibiTokenId,
  threadId,
  className,
}: {
  aibiTokenId: string;
  threadId?: string | null;
  className?: string;
}) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function go(e: React.MouseEvent) {
    e.stopPropagation(); // 背包卡片点击会开详情弹窗，按钮事件不向上冒泡
    if (busy) return;
    if (threadId) {
      router.push(`/chat?thread=${threadId}`);
      return;
    }
    setBusy(true);
    try {
      const res = await aibiFetch<{ threadId: string; created: boolean }>("/api/threads", {
        method: "POST",
        body: { aibiTokenId },
        locale,
      });
      router.push(`/chat?thread=${res.threadId}`);
    } catch (err) {
      if (err instanceof AibiClientError && err.status === 401) {
        const here = window.location.pathname + window.location.search;
        router.push(`/login?redirect=${encodeURIComponent(here)}`);
        return;
      }
      // 其它失败：恢复可点击（创建幂等，重试安全）
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => void go(e)}
      disabled={busy}
      className={
        className ??
        "rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50"
      }
    >
      {busy ? t("creatingThread") : threadId ? t("chatAction") : t("startChatting")}
    </button>
  );
}
