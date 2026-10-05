"use client";

/**
 * 明信片墙公开页 · 分享按钮（P2 社交传播 · 改动二）
 * 点击生成汇总分享图（/api/postcard-wall/[userId]/share.png，next/og 服务端渲染）：
 * 移动端 navigator.share（图片文件 + 预填文案带公开页链接）→ 桌面降级下载 PNG →
 * 失败兜底新标签打开。与灵魂卡分享同一交互模式。
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

export function PublicWallShareButton({
  userId,
  total,
  locale,
}: {
  userId: string;
  total: number;
  locale: string;
}) {
  const t = useTranslations("explorationV2.postcardWall");
  const [sharing, setSharing] = useState(false);

  async function share() {
    if (sharing) return;
    setSharing(true);
    const pngUrl = `/api/postcard-wall/${userId}/share.png`;
    const pageUrl = `${window.location.origin}/${locale}/postcard-wall/${userId}`;
    const text = t("shareWallText", { n: total, url: pageUrl });
    try {
      const res = await fetch(pngUrl);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const file = new File([blob], "postcard-wall.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
        return;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(pngUrl, "_blank", "noreferrer");
    } finally {
      setSharing(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void share()}
      disabled={sharing}
      className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 py-2.5 text-sm font-bold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {sharing ? t("sharing") : t("shareWall")}
    </button>
  );
}
