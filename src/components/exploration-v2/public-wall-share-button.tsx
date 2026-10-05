"use client";

/**
 * 明信片墙公开页 · 分享按钮（P2 社交传播 · 改动二）
 * 点击生成汇总分享图（/api/postcard-wall/[userId]/share.png，next/og 服务端渲染）：
 * 移动端 navigator.share（图片文件 + 预填文案带公开页链接）→ 桌面降级下载 PNG →
 * 失败兜底新标签打开。与灵魂卡分享同一交互模式。
 *
 * Phase 7 · 7.8 增强：
 *  - 7.8-1 模板选择：classic/night/blossom 三套主题色块选择条（?template= 注入分享图，
 *    localStorage 记忆上次选择，非法值回退 classic）；
 *  - 7.8-3 分享奖励：分享动作成功后（navigator.share resolved / 下载已触发），
 *    登录用户调 POST /api/postcard-wall/share-reward（每日首次 +5 积分，
 *    服务端 ref 唯一幂等防刷；已领/未登录静默不提示）。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/** 7.8-1 模板选择条（色块预览 = 分享图背景渐变；与 route.tsx SHARE_TEMPLATES 同源口径）。 */
const TEMPLATE_OPTIONS: { id: string; swatch: string }[] = [
  { id: "classic", swatch: "bg-gradient-to-br from-violet-600 to-pink-600" },
  { id: "night", swatch: "bg-gradient-to-br from-slate-900 to-blue-800" },
  { id: "blossom", swatch: "bg-gradient-to-br from-rose-300 to-pink-300" },
];
const TEMPLATE_STORAGE_KEY = "aiabw_wall_template";

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
  // 7.8-1 模板选择（picker 展开态 + 当前模板）
  const [pickerOpen, setPickerOpen] = useState(false);
  const [template, setTemplate] = useState("classic");
  // 7.8-3 奖励提示（+N 积分，数秒后自动消失）
  const [rewardTip, setRewardTip] = useState<string | null>(null);

  useEffect(() => {
    const saved =
      typeof window !== "undefined" ? localStorage.getItem(TEMPLATE_STORAGE_KEY) : null;
    if (saved && TEMPLATE_OPTIONS.some((o) => o.id === saved)) setTemplate(saved);
  }, []);

  /** 7.8-3 分享成功后领取每日首享奖励（服务端幂等；失败/已领静默）。 */
  async function claimShareReward() {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    try {
      const res = await fetch("/api/postcard-wall/share-reward", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.ok && data.rewarded) {
        setRewardTip(t("shareReward", { points: data.points }));
        setTimeout(() => setRewardTip(null), 4000);
      }
    } catch {
      // 奖励失败不影响分享主流程
    }
  }

  async function share() {
    if (sharing) return;
    setSharing(true);
    setPickerOpen(false);
    const pngUrl = `/api/postcard-wall/${userId}/share.png?template=${template}`;
    const pageUrl = `${window.location.origin}/${locale}/postcard-wall/${userId}`;
    const text = t("shareWallText", { n: total, url: pageUrl });
    try {
      const res = await fetch(pngUrl);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const file = new File([blob], `postcard-wall-${template}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
        void claimShareReward();
        return;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(a.href);
      void claimShareReward();
    } catch {
      window.open(pngUrl, "_blank", "noreferrer");
    } finally {
      setSharing(false);
    }
  }

  function pickTemplate(id: string) {
    setTemplate(id);
    localStorage.setItem(TEMPLATE_STORAGE_KEY, id);
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {/* 7.8-1 模板选择条（点击主按钮旁的 🎨 展开；色块即分享图背景预览） */}
      {pickerOpen ? (
        <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white/90 px-3 py-1.5 shadow-sm backdrop-blur">
          <span className="text-[11px] text-zinc-500">{t("templatePick")}</span>
          {TEMPLATE_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => pickTemplate(o.id)}
              aria-label={t(`template.${o.id}`)}
              title={t(`template.${o.id}`)}
              className={`h-6 w-6 rounded-full ${o.swatch} transition ${
                template === o.id
                  ? "ring-2 ring-violet-500 ring-offset-2"
                  : "opacity-70 hover:opacity-100"
              }`}
            />
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          aria-label={t("templatePick")}
          title={t("templatePick")}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-violet-200 bg-white text-base shadow-sm transition hover:border-violet-300"
        >
          🎨
        </button>
        <button
          type="button"
          onClick={() => void share()}
          disabled={sharing}
          className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 py-2.5 text-sm font-bold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sharing ? t("sharing") : t("shareWall")}
        </button>
      </div>
      {/* 7.8-3 奖励提示（每日首次分享 +N 积分） */}
      {rewardTip ? (
        <p className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600 shadow-sm">
          {rewardTip}
        </p>
      ) : null}
    </div>
  );
}
