"use client";

/**
 * FusionModal · 艾比融合弹窗（Phase 6 · 6.1）
 *  - 6.1.1 入口：背包页「融合」按钮（持有 ≥2 只时出现）；
 *  - 6.1.2 选择 2~5 只素材（与服务端 FUSION_MIN/FUSION_MAX 一致），实时预览结果稀有度
 *    （= 素材中的最高档，与服务端 fuseAibis 规则一致）；
 *  - 6.1.3 POST /api/aibi/fuse { tokenIds }；业务错误经 AibiErrorBanner 展示；
 *  - 6.1.4 结果动画：素材聚合 → 光核 → 新艾比揭晓（关键帧仅 transform/opacity）；
 *    prefers-reduced-motion 直接揭晓；成功即经 onFused 通知父级刷新背包；
 *  - 6.1.5 揭晓动作：「查看详情」（onViewDetail → 父级打开新艾比详情）/「继续融合」
 *    （重置回选择阶段；本会话已消耗素材经 spentIds 本地过滤，防止父级重拉间隙复选）。
 */
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { AibiCard } from "./aibi-card";
import { AibiErrorBanner } from "./aibi-error-banner";
import { aibiFetch, AibiClientError } from "@/lib/aibi-client";
import { getAibiRarity } from "@/lib/aibi-catalog";
import { aibiSpeciesEmoji, rarityVisual, type AibiTokenDto } from "@/lib/aibi-visual";

/** 与服务端 src/lib/aibi-service.ts 的 FUSION_MIN / FUSION_MAX 保持一致 */
const MIN_MATERIALS = 2;
const MAX_MATERIALS = 5;

export interface FusionResultDto {
  consumed: string[];
  minted: {
    aibiTokenId: string;
    speciesId: string;
    ownerId: string | null;
    status: string;
    mintedAt: string;
    supplyAfter: number;
    species: NonNullable<AibiTokenDto["species"]>;
  };
}

type Stage = "picking" | "absorb" | "reveal";

// 性能：关键帧仅 transform/opacity（不动 layout）
const KEYFRAMES = `
@keyframes fm-shrink { to { transform: scale(.12); opacity: 0; } }
@keyframes fm-core { 0% { transform: scale(0); opacity: 0 } 60% { transform: scale(1.3); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
@keyframes fm-reveal { 0% { transform: scale(.45); opacity: 0 } 70% { transform: scale(1.06); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
`;

export function FusionModal({
  aibis,
  locale,
  onClose,
  onFused,
  onViewDetail,
}: {
  aibis: AibiTokenDto[];
  locale: string;
  onClose: () => void;
  /** 融合成功回调：父级刷新背包（素材已销毁、新艾比已入库） */
  onFused: (result: FusionResultDto) => void;
  /** 6.1.5 揭晓「查看详情」：父级打开新艾比详情弹窗（可选，不传则不渲染该按钮） */
  onViewDetail?: (tokenId: string) => void;
}) {
  const t = useTranslations("aibi.fuse");
  const isEn = locale === "en";

  const [picked, setPicked] = useState<string[]>([]);
  const [stage, setStage] = useState<Stage>("picking");
  const [result, setResult] = useState<FusionResultDto | null>(null);
  const [fusing, setFusing] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const materials = useMemo(
    () => aibis.filter((tk) => pickedSet.has(tk.aibiTokenId)),
    [aibis, pickedSet],
  );
  /** 本弹窗会话内已消耗的素材（6.1.5：父级重拉完成前，防止再次选中已销毁素材） */
  const [spentIds, setSpentIds] = useState<ReadonlySet<string>>(new Set());
  const available = useMemo(
    () => aibis.filter((tk) => !spentIds.has(tk.aibiTokenId)),
    [aibis, spentIds],
  );

  /** 结果稀有度预览 = 已选素材中的最高档（与服务端 fuseAibis 规则一致） */
  const predictedRarityId = useMemo(() => {
    let top: string | null = null;
    let sort = -1;
    for (const tk of materials) {
      const r = getAibiRarity(tk.species?.rarityId ?? "common");
      if (r && r.sortOrder > sort) {
        sort = r.sortOrder;
        top = r.id;
      }
    }
    return top;
  }, [materials]);

  function toggle(tokenId: string) {
    setError(null);
    setPicked((prev) =>
      prev.includes(tokenId)
        ? prev.filter((x) => x !== tokenId)
        : prev.length >= MAX_MATERIALS
          ? prev
          : [...prev, tokenId],
    );
  }

  /** 6.1.3 融合：POST /api/aibi/fuse；成功 → 父级刷新 + 播放结果动画 */
  async function doFuse() {
    if (picked.length < MIN_MATERIALS || fusing) return;
    setFusing(true);
    setError(null);
    try {
      const res = await aibiFetch<FusionResultDto>("/api/aibi/fuse", {
        method: "POST",
        body: { tokenIds: picked },
        locale,
      });
      setResult(res);
      setSpentIds((prev) => new Set([...prev, ...picked]));
      onFused(res);
      if (reducedMotion) {
        setStage("reveal");
      } else {
        setStage("absorb");
        setTimeout(() => setStage("reveal"), 1400);
      }
    } catch (e) {
      if (e instanceof AibiClientError) setError({ code: e.code, message: e.message });
      else setError({ message: t("failed") });
    } finally {
      setFusing(false);
    }
  }

  /** 6.1.5 「继续融合」：重置回选择阶段（已消耗素材经 spentIds 过滤，不再出现） */
  function continueFuse() {
    setPicked([]);
    setResult(null);
    setError(null);
    setStage("picking");
  }

  const mintedToken: AibiTokenDto | null = result
    ? {
        aibiTokenId: result.minted.aibiTokenId,
        speciesId: result.minted.speciesId,
        status: result.minted.status,
        physicalBound: false,
        createdAt: result.minted.mintedAt,
        personalityType: result.minted.species.personalityTemplate,
        mood: isEn ? "Curious" : "好奇",
        affinity: 0,
        energy: 100,
        growthLevel: 1,
        growthExp: 0,
        species: result.minted.species,
      }
    : null;
  const mintedRv = rarityVisual(result?.minted.species.rarityId ?? "common");
  const predictedName = predictedRarityId
    ? (isEn
        ? getAibiRarity(predictedRarityId)?.nameEn
        : getAibiRarity(predictedRarityId)?.nameZh) ?? predictedRarityId
    : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center"
      onClick={stage === "picking" ? onClose : undefined}
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-white p-4 shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <style>{KEYFRAMES}</style>

        {stage === "picking" ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-black text-zinc-900 dark:text-zinc-50">
                  🧬 {t("title")}
                </h3>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("hint")}</p>
                <p className="mt-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                  ⚠️ {t("rule")}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("done")}
                className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
              >
                ✕
              </button>
            </div>

            {/* 素材选择网格（2~5 只，6.1.2；已消耗素材经 spentIds 过滤） */}
            <div className="mt-3 grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
              {available.map((tk) => {
                const on = pickedSet.has(tk.aibiTokenId);
                return (
                  <button
                    key={tk.aibiTokenId}
                    type="button"
                    onClick={() => toggle(tk.aibiTokenId)}
                    aria-pressed={on}
                    className={`relative rounded-2xl border p-2 text-center transition ${
                      on
                        ? "border-purple-400 bg-purple-50 dark:border-purple-500 dark:bg-purple-950/40"
                        : "border-zinc-200 hover:border-purple-200 dark:border-zinc-700"
                    }`}
                  >
                    <span className="block text-3xl">{aibiSpeciesEmoji(tk.speciesId)}</span>
                    <span className="mt-1 block truncate text-[11px] font-semibold text-zinc-800 dark:text-zinc-100">
                      {tk.species ? (isEn ? tk.species.nameEn : tk.species.nameZh) : tk.speciesId}
                    </span>
                    <span className="block text-[10px] text-zinc-400">
                      Lv.{tk.growthLevel ?? 1}
                    </span>
                    {on ? (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-purple-500 px-1.5 text-[10px] font-bold text-white">
                        {picked.indexOf(tk.aibiTokenId) + 1}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {error ? (
              <div className="mt-3">
                <AibiErrorBanner code={error.code} message={error.message} onClose={() => setError(null)} />
              </div>
            ) : null}

            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="min-w-0 text-[11px] text-zinc-400">
                <p>{t("selected", { count: picked.length })}</p>
                {predictedRarityId ? (
                  <p className="font-semibold" style={{ color: rarityVisual(predictedRarityId).color }}>
                    {t("predicted", { rarity: predictedName })}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                disabled={picked.length < MIN_MATERIALS || fusing}
                onClick={() => void doFuse()}
                className="shrink-0 rounded-2xl bg-gradient-to-r from-purple-500 to-fuchsia-500 px-6 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40"
              >
                {fusing ? t("fusing") : picked.length < MIN_MATERIALS ? t("needMore") : t("confirm")}
              </button>
            </div>
          </>
        ) : null}


        {/* 融合动画（6.1.4）：素材聚合 → 光核闪现 */}
        {stage === "absorb" ? (
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-6">
            <div className="flex items-center gap-3">
              {materials.map((tk, i) => (
                <span
                  key={tk.aibiTokenId}
                  className="text-4xl"
                  style={{ animation: `fm-shrink 1s ease-in ${i * 0.12}s both` }}
                >
                  {aibiSpeciesEmoji(tk.speciesId)}
                </span>
              ))}
            </div>
            <span
              className="text-6xl leading-none"
              style={{
                animation: "fm-core 1.1s ease-out .35s both",
                filter: `drop-shadow(0 0 22px ${mintedRv.color})`,
              }}
            >
              ✨
            </span>
            <p className="text-sm text-zinc-400">{t("fusing")}</p>
          </div>
        ) : null}

        {/* 揭晓：新艾比卡片 + 新凭证编号 */}
        {stage === "reveal" && result && mintedToken ? (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <p className="text-lg font-black" style={{ color: mintedRv.color }}>
              🎉 {t("resultTitle")}
            </p>
            <p className="text-xs text-zinc-400">
              {t("resultHint", { count: result.consumed.length })}
            </p>
            <div
              className="w-full max-w-[220px]"
              style={{ animation: reducedMotion ? undefined : "fm-reveal .7s ease both" }}
            >
              <AibiCard token={mintedToken} locale={locale} size="lg" showGrowth />
            </div>
            <p className="font-mono text-[11px] text-zinc-400">
              {t("newCert")}：{result.minted.aibiTokenId}
            </p>
            {/* 6.1.5 揭晓动作：查看详情 / 继续融合 / 完成 */}
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
              {onViewDetail ? (
                <button
                  type="button"
                  onClick={() => onViewDetail(result.minted.aibiTokenId)}
                  className="rounded-2xl border border-purple-300 px-5 py-2.5 text-sm font-bold text-purple-600 transition hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-950/40"
                >
                  {t("viewDetail")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={continueFuse}
                disabled={available.length < MIN_MATERIALS}
                className="rounded-2xl border border-zinc-300 px-5 py-2.5 text-sm font-bold text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t("continueFuse")}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-2xl bg-gradient-to-r from-purple-500 to-fuchsia-500 px-8 py-2.5 text-sm font-bold text-white transition hover:opacity-90"
              >
                {t("done")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

