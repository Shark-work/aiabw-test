"use client";

/**
 * PacksClient · 卡包商店（Phase 5 · 5.1）
 *  - GET /api/pack/list 拉取卡包（名称/价格/稀有度概率/产出范围），公开可读；
 *  - 未登录 → 登录引导（5.1.3）；已登录 → 「购买」→ POST /api/pack/buy（5.1.4）；
 *  - 购买成功 → 跳转 /packs/result?packId=xx 开包结果页（5.1.5）；
 *  - 失败 → AibiErrorBanner 展示错误码（INSUFFICIENT_POINTS / PACK_NOT_FOUND 等，5.1.6）；
 *  - 加载骨架屏 + 按钮 loading（技术要求 3）；响应式网格（技术要求 5）。
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";
import { AibiErrorBanner } from "./aibi-error-banner";
import { aibiFetch, AibiClientError, readAibiToken } from "@/lib/aibi-client";
import { AIBI_PACK_SALES_DISCONTINUED } from "@/lib/aibi-flags";
import { AIBI_RARITIES } from "@/lib/aibi-catalog";
import { rarityVisual } from "@/lib/aibi-visual";

interface PackDto {
  id: string;
  nameZh: string;
  nameEn: string;
  pricePoints: number;
  rarityWeights: Record<string, number>;
  allowedRarities: string[];
  animationLevel: number;
}

type LoadState = "loading" | "ready" | "error";

export function PacksClient() {
  const t = useTranslations("aibi.packs");
  const locale = useLocale();
  const isEn = locale === "en";
  const router = useRouter();

  const [state, setState] = useState<LoadState>("loading");
  const [packs, setPacks] = useState<PackDto[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await aibiFetch<{ packs: PackDto[] }>("/api/pack/list", { locale });
      setPacks(data.packs ?? []);
      setSignedIn(!!readAibiToken());
      setState("ready");
    } catch {
      setState("error");
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  async function buy(packId: string) {
    // P0 概念收敛（2026-10-14）：卡包停售，前端先行拦截（服务端同步 410 短路）
    if (AIBI_PACK_SALES_DISCONTINUED) {
      setError({ code: "DISCONTINUED", message: t("discontinued") });
      return;
    }
    setBuying(packId);
    setError(null);
    try {
      await aibiFetch("/api/pack/buy", { method: "POST", body: { packId, quantity: 1 }, locale });
      // 5.1.5 购买成功 → 跳转开包结果页（由结果页执行 /api/pack/open）
      router.push(`/packs/result?packId=${encodeURIComponent(packId)}`);
    } catch (e) {
      if (e instanceof AibiClientError) {
        if (e.status === 401) {
          setSignedIn(false);
          setError({ code: e.code, message: e.message });
        } else {
          setError({ code: e.code, message: e.message });
        }
      } else {
        setError({ message: t("buyFailed") });
      }
      setBuying(null);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-black text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
      </header>

      {/* P0 概念收敛：卡包停售公告（购买按钮同步禁用） */}
      {AIBI_PACK_SALES_DISCONTINUED ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
          {t("discontinued")}
        </p>
      ) : null}

      {error ? <AibiErrorBanner code={error.code} message={error.message} onClose={() => setError(null)} /> : null}

      {state === "loading" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-52 animate-pulse rounded-3xl bg-zinc-100 dark:bg-zinc-800" />
          ))}
        </div>
      ) : null}

      {state === "error" ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-400 dark:border-zinc-700">
          {t("loadFailed")}
        </p>
      ) : null}

      {state === "ready" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {packs.map((p) => (
            <PackCard
              key={p.id}
              pack={p}
              isEn={isEn}
              signedIn={signedIn}
              buying={buying === p.id}
              disabled={buying !== null || AIBI_PACK_SALES_DISCONTINUED}
              onBuy={() => void buy(p.id)}
            />
          ))}
        </div>
      ) : null}

      {state === "ready" && !signedIn ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-center text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          {t("signInHint")}{" "}
          <Link href="/login" className="font-bold underline">
            {t("signIn")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/** 单个卡包卡片：展示图（emoji+顶档稀有度渐变）/ 名称 / 价格 / 稀有度概率条 / 购买按钮 */
function PackCard({
  pack,
  isEn,
  signedIn,
  buying,
  disabled,
  onBuy,
}: {
  pack: PackDto;
  isEn: boolean;
  signedIn: boolean;
  buying: boolean;
  disabled: boolean;
  onBuy: () => void;
}) {
  const t = useTranslations("aibi.packs");
  // 顶档稀有度决定卡包主视觉色（allowedRarities 中 sortOrder 最大者）
  const topRarityId = [...pack.allowedRarities].sort(
    (a, b) =>
      (AIBI_RARITIES.find((r) => r.id === b)?.sortOrder ?? 0) -
      (AIBI_RARITIES.find((r) => r.id === a)?.sortOrder ?? 0),
  )[0];
  const rv = rarityVisual(topRarityId ?? "common");

  return (
    <div
      className="overflow-hidden rounded-3xl border bg-white dark:bg-zinc-900"
      style={{ borderColor: rv.color, boxShadow: `0 10px 30px -14px ${rv.color}88` }}
    >
      {/* 展示图：emoji 立绘占位 + 顶档稀有度渐变（正式素材后替换 img 懒加载） */}
      <div
        className="flex h-28 items-center justify-center"
        style={{ background: `linear-gradient(135deg, ${rv.color}44, ${rv.color}11 55%, transparent)` }}
      >
        <span className="text-6xl leading-none" style={{ filter: `drop-shadow(0 6px 14px ${rv.color}aa)` }}>
          🎴
        </span>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {isEn ? pack.nameEn : pack.nameZh}
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              {rv.emoji} {isEn ? rv.rarity?.nameEn : rv.rarity?.nameZh} · {t("animationLv", { level: pack.animationLevel })}
            </p>
          </div>
          <p className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-sm font-black text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
            ⭐ {pack.pricePoints}
          </p>
        </div>

        {/* 稀有度概率（5.1.2） */}
        <div className="space-y-1">
          {AIBI_RARITIES.filter((r) => (pack.rarityWeights[r.id] ?? 0) > 0).map((r) => {
            const pct = pack.rarityWeights[r.id] ?? 0;
            return (
              <div key={r.id} className="flex items-center gap-2 text-[11px]">
                <span className="w-10 shrink-0 font-semibold" style={{ color: r.color }}>
                  {isEn ? r.nameEn : r.nameZh}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: r.color }} />
                </div>
                <span className="w-9 shrink-0 text-right tabular-nums text-zinc-400">{pct}%</span>
              </div>
            );
          })}
        </div>

        {signedIn ? (
          <button
            type="button"
            onClick={onBuy}
            disabled={disabled}
            className="w-full rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {buying ? t("buying") : t("buy")}
          </button>
        ) : (
          <Link
            href="/login"
            className="block w-full rounded-2xl border border-orange-300 py-2.5 text-center text-sm font-bold text-orange-600 dark:border-orange-700 dark:text-orange-400"
          >
            {t("signInToBuy")}
          </Link>
        )}
      </div>
    </div>
  );
}

