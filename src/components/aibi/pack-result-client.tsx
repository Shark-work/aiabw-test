"use client";

/**
 * PackResultClient · 开包结果页（Phase 5 · 5.2）
 *  - 挂载后调用 POST /api/pack/open 执行开包（5.2.1）；
 *  - 动画不阻塞接口：先 await 拿到结果，再挂载 PackOpenAnimation 播放（5.6.5）；
 *  - React StrictMode 开发环境 effect 双跑 → 已启动标记防重复消耗卡包；
 *  - 动画结束展示 AibiCard + 三按钮：查看艾比详情 / 再开一包 / 返回背包（5.2.4）；
 *  - 失败（INSUFFICIENT_ITEM 等）→ AibiErrorBanner + 回商店引导。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { Link } from "@/i18n/navigation";
import { AibiDetailModal } from "./aibi-detail-modal";
import { AibiErrorBanner } from "./aibi-error-banner";
import { PackOpenAnimation } from "./pack-open-animation";
import { aibiFetch, AibiClientError } from "@/lib/aibi-client";
import { animationTierForRarity, type AibiTokenDto } from "@/lib/aibi-visual";

interface OpenResult {
  packId: string;
  rarity: string;
  species: AibiTokenDto["species"];
  token: AibiTokenDto;
}

type Stage = "opening" | "animating" | "revealed" | "error";

export function PackResultClient() {
  const t = useTranslations("aibi.packOpen");
  const locale = useLocale();
  const isEn = locale === "en";
  const searchParams = useSearchParams();
  const packId = searchParams.get("packId") ?? "";

  const [stage, setStage] = useState<Stage>("opening");
  const [result, setResult] = useState<OpenResult | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const startedRef = useRef(false);

  const openPack = useCallback(async () => {
    setStage("opening");
    setError(null);
    try {
      // 5.6.5 先取结果：接口返回后才进入动画阶段
      const data = await aibiFetch<OpenResult>("/api/pack/open", {
        method: "POST",
        body: { packId },
        locale,
      });
      setResult(data);
      setStage("animating");
    } catch (e) {
      if (e instanceof AibiClientError) setError({ code: e.code, message: e.message });
      else setError({ message: t("openFailed") });
      setStage("error");
    }
  }, [packId, locale, t]);

  useEffect(() => {
    // StrictMode 双跑守卫：/api/pack/open 会真实消耗卡包，只允许调用一次
    if (startedRef.current) return;
    startedRef.current = true;
    if (packId) void openPack();
    else {
      setError({ message: t("missingPack") });
      setStage("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅首次挂载开一包
  }, []);

  /** 再开一包（5.2.4）：重置状态并重放动画；库存不足时由接口 400 兜底 */
  function openAnother() {
    setResult(null);
    void openPack();
  }

  const packName = result
    ? isEn
      ? (result.species?.nameEn ?? result.packId)
      : (result.species?.nameZh ?? result.packId)
    : packId;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-black text-zinc-900 dark:text-zinc-50">{t("title")}</h1>

      {stage === "opening" ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-3xl border border-zinc-200 dark:border-zinc-700">
          <p className="animate-pulse text-6xl">🎴</p>
          <p className="text-sm text-zinc-400">{t("opening")}</p>
        </div>
      ) : null}

      {stage === "error" && error ? (
        <div className="space-y-4">
          <AibiErrorBanner code={error.code} message={error.message} />
          <div className="flex justify-center gap-3">
            <Link
              href="/packs"
              className="rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-2.5 text-sm font-bold text-white"
            >
              {t("backToStore")}
            </Link>
            <Link
              href="/bag"
              className="rounded-2xl border border-zinc-300 px-5 py-2.5 text-sm font-semibold text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
            >
              {t("backToBag")}
            </Link>
          </div>
        </div>
      ) : null}

      {(stage === "animating" || stage === "revealed") && result ? (
        <>
          {/* 5.2.2 按稀有度档位播放动画；onReveal 后展示操作按钮（5.2.3/5.2.4） */}
          <PackOpenAnimation
            tier={animationTierForRarity(result.rarity)}
            token={result.token}
            packName={packName}
            locale={locale}
            onReveal={() => setStage("revealed")}
          />
          {stage === "revealed" ? (
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => setDetailOpen(true)}
                className="rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-2.5 text-sm font-bold text-white"
              >
                {t("viewDetail")}
              </button>
              <button
                type="button"
                onClick={openAnother}
                className="rounded-2xl border border-orange-300 px-5 py-2.5 text-sm font-bold text-orange-600 dark:border-orange-700 dark:text-orange-400"
              >
                {t("openAnother")}
              </button>
              <Link
                href="/bag"
                className="rounded-2xl border border-zinc-300 px-5 py-2.5 text-sm font-semibold text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
              >
                {t("backToBag")}
              </Link>
            </div>
          ) : null}
        </>
      ) : null}

      {detailOpen && result ? (
        <AibiDetailModal token={result.token} locale={locale} onClose={() => setDetailOpen(false)} />
      ) : null}
    </div>
  );
}

