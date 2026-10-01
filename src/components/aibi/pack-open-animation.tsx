"use client";

/**
 * PackOpenAnimation · 开包动画（Phase 5 · 5.6）
 *  - 可复用：入参仅 { tier, token, packName, locale, onReveal }，不感知接口；
 *  - 动画不阻塞接口请求：父组件先拿到 /api/pack/open 结果再挂载本组件播放；
 *  - 五档稀有度动画（5.2）：1 落卡光效 / 2 翻转元素光 / 3 背景光柱展开 /
 *    4 全屏登场放大+凭证编号 / 5 全屏+凭证生成动画+AI 自我介绍；
 *  - 支持跳过；移动端与 prefers-reduced-motion 降级为轻量淡入；
 *  - 纯 CSS transform/opacity 关键帧，不动 layout、不阻塞主线程。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { AibiCard } from "./aibi-card";
import { aibiSpeciesEmoji, rarityVisual, type AibiTokenDto, type RarityAnimationTier } from "@/lib/aibi-visual";

type Stage = "sealed" | "burst" | "reveal";

/** 各档位的（封包→迸发）时长 ms；reveal 常驻。移动端/减动效全部走 LITE。 */
const TIER_TIMING: Record<RarityAnimationTier, { sealed: number; burst: number }> = {
  1: { sealed: 700, burst: 500 },
  2: { sealed: 800, burst: 700 },
  3: { sealed: 900, burst: 900 },
  4: { sealed: 1000, burst: 1100 },
  5: { sealed: 1100, burst: 1400 },
};
const LITE_TIMING = { sealed: 250, burst: 250 };

export function PackOpenAnimation({
  tier,
  token,
  packName,
  locale,
  onReveal,
}: {
  tier: RarityAnimationTier;
  token: AibiTokenDto;
  packName: string;
  locale: string;
  onReveal?: () => void;
}) {
  const t = useTranslations("aibi.packOpen");
  const isEn = locale === "en";
  const rv = rarityVisual(token.species?.rarityId ?? "common");

  /** 移动端 / 减动效降级：轻量动画（5.6 · 4） */
  const lite = useMemo(() => {
    if (typeof window === "undefined") return false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrow = window.matchMedia("(max-width: 640px)").matches;
    return reduced || narrow;
  }, []);
  const timing = lite ? LITE_TIMING : TIER_TIMING[tier];

  const [stage, setStage] = useState<Stage>("sealed");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const revealed = useRef(false);

  const finish = () => {
    if (revealed.current) return;
    revealed.current = true;
    setStage("reveal");
    onReveal?.();
  };

  useEffect(() => {
    timers.current.push(setTimeout(() => setStage("burst"), timing.sealed));
    timers.current.push(setTimeout(finish, timing.sealed + timing.burst));
    return () => {
      timers.current.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅按挂载时 timing 播放一次
  }, []);

  const sp = token.species;
  const emoji = aibiSpeciesEmoji(sp?.id ?? "");
  const fullscreen = tier >= 4 && !lite;

  return (
    <div
      className={`relative overflow-hidden rounded-3xl border text-center ${
        fullscreen ? "border-transparent" : "border-zinc-200 dark:border-zinc-700"
      }`}
      style={
        fullscreen
          ? { background: `radial-gradient(ellipse at center, ${rv.color}33, #000000cc 75%)` }
          : tier >= 3
            ? { background: `linear-gradient(160deg, ${rv.color}22, transparent 65%)` }
            : undefined
      }
    >
      <style>{KEYFRAMES}</style>

      {/* 跳过动画（5.6 · 2） */}
      {stage !== "reveal" ? (
        <button
          type="button"
          onClick={finish}
          className="absolute right-3 top-3 z-20 rounded-full bg-black/30 px-3 py-1 text-xs font-semibold text-white backdrop-blur hover:bg-black/50"
        >
          {t("skip")} ⏭
        </button>
      ) : null}


      <div className={`relative z-10 flex min-h-[320px] flex-col items-center justify-center px-4 py-8 ${fullscreen ? "min-h-[420px]" : ""}`}>
        {stage === "sealed" ? (
          <div className={lite ? "aibi-fade-in" : "aibi-pack-idle"}>
            <p className="text-7xl leading-none">🎴</p>
            <p className={`mt-3 text-sm font-semibold ${fullscreen ? "text-white" : "text-zinc-600 dark:text-zinc-300"}`}>
              {packName}
            </p>
            <p className={`mt-1 text-xs ${fullscreen ? "text-white/70" : "text-zinc-400"}`}>{t("opening")}</p>
          </div>
        ) : null}

        {stage === "burst" ? (
          <div className="relative flex items-center justify-center">
            {/* 光柱（tier≥3） */}
            {tier >= 3 && !lite ? (
              <div
                aria-hidden
                className="aibi-beam absolute -top-24 h-72 w-16 rounded-full opacity-70 blur-md"
                style={{ background: `linear-gradient(to bottom, ${rv.color}, transparent)` }}
              />
            ) : null}
            {/* 元素光效环 */}
            <div
              aria-hidden
              className={`${lite ? "aibi-fade-in" : "aibi-burst"} absolute h-40 w-40 rounded-full`}
              style={{ background: `radial-gradient(circle, ${rv.color}aa, transparent 70%)` }}
            />
            <span
              className={`relative text-8xl leading-none ${
                lite ? "aibi-fade-in" : tier === 1 ? "aibi-drop" : tier === 2 ? "aibi-flip" : "aibi-zoom"
              }`}
              style={{ filter: `drop-shadow(0 0 18px ${rv.color})` }}
            >
              {emoji}
            </span>
          </div>
        ) : null}

        {stage === "reveal" ? (
          <div className="w-full max-w-xs">
            {/* 传说/神话：凭证编号登场（5.2）；神话附凭证生成动画 + AI 自我介绍 */}
            {tier >= 4 ? (
              <p
                className={`mb-3 font-mono text-xs tracking-widest ${lite ? "" : "aibi-forge"}`}
                style={{ color: rv.color }}
              >
                ⛓ {token.aibiTokenId}
              </p>
            ) : null}
            <div className={lite ? "aibi-fade-in" : tier === 1 ? "aibi-drop" : tier === 2 ? "aibi-flip" : "aibi-zoom"}>
              <AibiCard token={token} locale={locale} size="lg" showGrowth />
            </div>
            {tier >= 5 && sp ? (
              <p className="mt-3 rounded-2xl bg-black/30 px-4 py-2 text-xs italic text-white/90 backdrop-blur">
                💬 {t("selfIntro", {
                  name: isEn ? sp.nameEn : sp.nameZh,
                  personality: isEn ? sp.personalityTemplateEn : sp.personalityTemplate,
                })}
              </p>
            ) : null}
            <p className="mt-3 text-sm font-bold" style={{ color: rv.color }}>
              {rv.emoji} {t("congrats", { rarity: isEn ? rv.rarity?.nameEn ?? rv.id : rv.rarity?.nameZh ?? rv.id })}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}


/** 关键帧集中定义（scoped aibi- 前缀，避免污染全局）：仅 transform/opacity，合成层动画。 */
const KEYFRAMES = `
@keyframes aibi-fade-in-kf { from { opacity: 0 } to { opacity: 1 } }
@keyframes aibi-pack-idle-kf { 0%,100% { transform: translateY(0) scale(1) } 50% { transform: translateY(-8px) scale(1.04) } }
@keyframes aibi-drop-kf { 0% { opacity: 0; transform: translateY(-90px) scale(.85) } 60% { opacity: 1; transform: translateY(8px) scale(1.02) } 100% { opacity: 1; transform: translateY(0) scale(1) } }
@keyframes aibi-flip-kf { 0% { opacity: 0; transform: rotateY(90deg) scale(.9) } 100% { opacity: 1; transform: rotateY(0) scale(1) } }
@keyframes aibi-zoom-kf { 0% { opacity: 0; transform: scale(.3) } 70% { opacity: 1; transform: scale(1.08) } 100% { opacity: 1; transform: scale(1) } }
@keyframes aibi-burst-kf { 0% { opacity: 0; transform: scale(.2) } 55% { opacity: .95; transform: scale(1.25) } 100% { opacity: .35; transform: scale(1) } }
@keyframes aibi-beam-kf { 0% { opacity: 0; transform: scaleY(.2) } 100% { opacity: .7; transform: scaleY(1) } }
@keyframes aibi-forge-kf { 0% { opacity: 0; letter-spacing: .6em; filter: blur(4px) } 100% { opacity: 1; letter-spacing: .15em; filter: blur(0) } }
@keyframes aibi-breathe-kf { 0%,100% { transform: scale(1) } 50% { transform: scale(1.06) } }
.aibi-fade-in { animation: aibi-fade-in-kf .3s ease both }
.aibi-pack-idle { animation: aibi-pack-idle-kf 1s ease-in-out infinite }
.aibi-drop { animation: aibi-drop-kf .55s cubic-bezier(.2,.9,.3,1.2) both }
.aibi-flip { animation: aibi-flip-kf .6s ease both }
.aibi-zoom { animation: aibi-zoom-kf .7s ease both }
.aibi-burst { animation: aibi-burst-kf .8s ease both }
.aibi-beam { animation: aibi-beam-kf .8s ease both }
.aibi-forge { animation: aibi-forge-kf 1s ease both }
.aibi-breathe { animation: aibi-breathe-kf 2.4s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) {
  .aibi-pack-idle, .aibi-drop, .aibi-flip, .aibi-zoom, .aibi-burst, .aibi-beam, .aibi-forge, .aibi-breathe { animation: aibi-fade-in-kf .2s ease both }
}
`;
