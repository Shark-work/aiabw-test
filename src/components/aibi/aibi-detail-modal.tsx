"use client";

/**
 * AibiDetailModal · 艾比详情弹窗（Phase 5 · 5.4.4 + 5.5 互动入口）
 *  - 展示凭证编号 / 物种档案 / 性格 / 成长状态（等级/经验/亲密/精力实时条）；
 *  - 互动四动作 feed/train/talk/play → POST /api/interact { tokenId, action }，
 *    响应 state 就地刷新（5.5.3）；leveledUp 时播放升级动画（5.5.4）；
 *  - 精力不足等业务错误经 AibiErrorBanner 统一展示（错误码 + 本地化 message）。
 */
import { useState } from "react";
import { useTranslations } from "next-intl";

import { AibiCard } from "./aibi-card";
import { AibiErrorBanner } from "./aibi-error-banner";
import { aibiFetch, AibiClientError } from "@/lib/aibi-client";
import type { AibiTokenDto } from "@/lib/aibi-visual";

type InteractAction = "feed" | "train" | "talk" | "play";

interface GrowthStateDto {
  personalityType: string;
  mood: string;
  affinity: number;
  energy: number;
  growthLevel: number;
  growthExp: number;
}

export function AibiDetailModal({
  token,
  locale,
  onClose,
  onStateChange,
  onBurned,
}: {
  token: AibiTokenDto;
  locale: string;
  onClose: () => void;
  /** 互动/用道具后向上同步最新成长状态（列表页就地刷新） */
  onStateChange?: (tokenId: string, state: GrowthStateDto) => void;
  /**
   * 销毁成功回调（Phase 6 · 6.2）：父级移除列表项并关闭弹窗。
   * 仅持有者上下文传入（背包页）；未传入时「销毁」按钮不渲染。
   */
  onBurned?: (tokenId: string, supplyAfter: number) => void;
}) {
  const t = useTranslations("aibi.interact");
  const tb = useTranslations("aibi.burn");
  const isEn = locale === "en";
  const sp = token.species;

  const [state, setState] = useState<GrowthStateDto>({
    personalityType: token.personalityType ?? (sp ? (isEn ? sp.personalityTemplateEn : sp.personalityTemplate) : ""),
    mood: token.mood ?? "",
    affinity: token.affinity ?? 0,
    energy: token.energy ?? 0,
    growthLevel: token.growthLevel ?? 1,
    growthExp: token.growthExp ?? 0,
  });
  const [pending, setPending] = useState<InteractAction | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [levelUp, setLevelUp] = useState(false);
  /** 销毁二次确认状态机（6.2.2）：idle → confirm → burning */
  const [burnStep, setBurnStep] = useState<"idle" | "confirm" | "burning">("idle");

  const liveToken: AibiTokenDto = { ...token, ...state };

  async function doInteract(action: InteractAction) {
    setPending(action);
    setError(null);
    try {
      const res = await aibiFetch<{ state: GrowthStateDto; leveledUp: boolean }>("/api/interact", {
        method: "POST",
        body: { tokenId: token.aibiTokenId, action },
        locale,
      });
      setState(res.state);
      onStateChange?.(token.aibiTokenId, res.state);
      if (res.leveledUp) {
        setLevelUp(true);
        setTimeout(() => setLevelUp(false), 1800);
      }
    } catch (e) {
      if (e instanceof AibiClientError) setError({ code: e.code, message: e.message });
      else setError({ message: t("failed") });
    } finally {
      setPending(null);
    }
  }

  /** 6.2.3 销毁：POST /api/aibi/burn → 成功经 onBurned 通知父级（列表实时移除） */
  async function doBurn() {
    setBurnStep("burning");
    setError(null);
    try {
      const res = await aibiFetch<{ aibiTokenId: string; supplyAfter: number }>("/api/aibi/burn", {
        method: "POST",
        body: { tokenId: token.aibiTokenId },
        locale,
      });
      onBurned?.(res.aibiTokenId, res.supplyAfter);
    } catch (e) {
      if (e instanceof AibiClientError) setError({ code: e.code, message: e.message });
      else setError({ message: tb("failed") });
      setBurnStep("confirm");
    }
  }

  const ACTIONS: { id: InteractAction; emoji: string }[] = [
    { id: "feed", emoji: "🍎" },
    { id: "train", emoji: "🏋️" },
    { id: "talk", emoji: "💬" },
    { id: "play", emoji: "🎾" },
  ];


  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="relative w-full max-w-sm rounded-3xl bg-white p-4 shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <style>{`@keyframes aibi-levelup-kf { 0%{opacity:0;transform:scale(.5)} 40%{opacity:1;transform:scale(1.15)} 100%{opacity:0;transform:scale(1.4) translateY(-30px)} }`}</style>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="absolute right-3 top-3 z-10 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
        >
          ✕
        </button>

        {/* 升级动画覆盖层（5.5.4） */}
        {levelUp ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <p className="text-3xl font-black text-amber-400 drop-shadow-lg" style={{ animation: "aibi-levelup-kf 1.8s ease both" }}>
              🎉 {t("levelUp", { level: state.growthLevel })}
            </p>
          </div>
        ) : null}

        <AibiCard token={liveToken} locale={locale} size="lg" showGrowth />

        {/* 档案信息 */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <InfoCell label={t("mood")} value={state.mood || "—"} />
          <InfoCell label={t("personality")} value={state.personalityType || "—"} />
          <InfoCell label={t("element")} value={sp?.element ?? "—"} />
          <InfoCell label={t("cert")} value={token.aibiTokenId} mono />
        </div>
        {sp ? (
          <p className="mt-2 rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
            {isEn ? sp.descriptionEn : sp.description}
          </p>
        ) : null}

        {error ? (
          <div className="mt-3">
            <AibiErrorBanner code={error.code} message={error.message} onClose={() => setError(null)} />
          </div>
        ) : null}

        {/* 互动按钮（5.5.2）：feed/train/talk/play */}
        <div className="mt-4 grid grid-cols-4 gap-2">
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={pending !== null}
              onClick={() => void doInteract(a.id)}
              className="flex flex-col items-center gap-1 rounded-2xl border border-zinc-200 py-2.5 text-xs font-semibold text-zinc-700 transition hover:border-orange-300 hover:bg-orange-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <span className="text-lg">{a.emoji}</span>
              <span>{pending === a.id ? t("doing") : t(`actions.${a.id}`)}</span>
            </button>
          ))}
        </div>

        {/* 销毁入口（6.2.1/6.2.2）：仅持有者上下文渲染（onBurned 存在），二次确认 */}
        {onBurned ? (
          <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            {burnStep === "idle" ? (
              <button
                type="button"
                onClick={() => setBurnStep("confirm")}
                className="w-full rounded-2xl border border-red-200 py-2 text-xs font-semibold text-red-500 transition hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                🗑️ {tb("open")}
              </button>
            ) : (
              <div className="rounded-2xl border border-red-200 bg-red-50/60 p-3 dark:border-red-900/60 dark:bg-red-950/30">
                <p className="text-xs font-bold text-red-600 dark:text-red-400">
                  {tb("confirmTitle")}
                </p>
                <p className="mt-1 text-[11px] text-red-500/80 dark:text-red-400/70">
                  {tb("confirmHint")}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={burnStep === "burning"}
                    onClick={() => setBurnStep("idle")}
                    className="rounded-xl border border-zinc-200 py-2 text-xs font-semibold text-zinc-500 disabled:opacity-50 dark:border-zinc-700"
                  >
                    {tb("cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={burnStep === "burning"}
                    onClick={() => void doBurn()}
                    className="rounded-xl bg-red-500 py-2 text-xs font-bold text-white transition hover:bg-red-600 disabled:opacity-50"
                  >
                    {burnStep === "burning" ? tb("burning") : tb("confirm")}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InfoCell({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
      <p className="text-[10px] text-zinc-400">{label}</p>
      <p className={`mt-0.5 truncate font-semibold text-zinc-800 dark:text-zinc-100 ${mono ? "font-mono text-[11px]" : ""}`}>
        {value}
      </p>
    </div>
  );
}
