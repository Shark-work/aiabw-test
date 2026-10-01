"use client";

/**
 * AibiSoulPanel · 灵魂卡页艾比平台板块（Phase 5 · 5.4）
 *  - GET /api/aibi/supply 供应看板（5.4.2，公开）；
 *  - GET /api/aibi/list 可铸（可获得）物种列表（5.4.3，公开）；
 *  - 登录后经 /api/user/profile 取用户 ID → GET /api/aibi/owner/:wallet 持有列表（5.4.1）；
 *  - 艾比卡片点击 → AibiDetailModal：凭证编号 / 成长状态 / 互动入口（5.4.4）。
 * V1 宠物灵魂卡板块（SoulCardsClient）保留在本板块下方，互不影响。
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { AibiCard } from "./aibi-card";
import { AibiDetailModal } from "./aibi-detail-modal";
import { AibiErrorBanner } from "./aibi-error-banner";
import { aibiFetch, AibiClientError, readAibiToken } from "@/lib/aibi-client";
import { aibiSpeciesEmoji, rarityVisual, type AibiTokenDto } from "@/lib/aibi-visual";

interface SupplyDto {
  totalMinted: number;
  totalBurned: number;
  currentSupply: number;
  maxSupply: number | null;
}
interface SpeciesListDto {
  id: string;
  nameZh: string;
  nameEn: string;
  rarityId: string;
  element: string;
  habitatId: string;
  description: string;
  descriptionEn: string;
  mintedCount: number;
}
interface GrowthStateDto {
  personalityType: string;
  mood: string;
  affinity: number;
  energy: number;
  growthLevel: number;
  growthExp: number;
}

type LoadState = "loading" | "ready" | "error";

export function AibiSoulPanel() {
  const t = useTranslations("aibi.soul");
  const locale = useLocale();
  const isEn = locale === "en";

  const [state, setState] = useState<LoadState>("loading");
  const [supply, setSupply] = useState<SupplyDto | null>(null);
  const [species, setSpecies] = useState<SpeciesListDto[]>([]);
  const [mine, setMine] = useState<AibiTokenDto[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [detail, setDetail] = useState<AibiTokenDto | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      // 公开数据：供应看板 + 可铸列表（5.4.2/5.4.3）
      const [sup, list] = await Promise.all([
        aibiFetch<SupplyDto>("/api/aibi/supply", { locale }),
        aibiFetch<{ species: SpeciesListDto[] }>("/api/aibi/list", { locale }),
      ]);
      setSupply(sup);
      setSpecies(list.species ?? []);

      // 持有列表（5.4.1）：先取用户 ID，再走 owner/:wallet 接口
      const token = readAibiToken();
      if (!token) {
        setMine([]);
        setSignedIn(false);
        setState("ready");
        return;
      }
      try {
        // /api/user/profile 为旧格式 { ok, user:{id} }（非 aibi {data} 格式），用原生 fetch
        const r = await fetch("/api/user/profile", { headers: { Authorization: `Bearer ${token}` } });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; user?: { id?: string } };
        const userId = j?.user?.id ?? null;
        if (!userId) {
          setSignedIn(false);
          setMine([]);
          setState("ready");
          return;
        }
        setSignedIn(true);
        const owned = await aibiFetch<{ tokens: AibiTokenDto[] }>(
          `/api/aibi/owner/${encodeURIComponent(userId)}`,
          { locale },
        );
        setMine(owned.tokens ?? []);
      } catch (e) {
        if (e instanceof AibiClientError && e.status === 401) setSignedIn(false);
        setMine([]);
      }
      setState("ready");
    } catch {
      setState("error");
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  function syncState(tokenId: string, s: GrowthStateDto) {
    setMine((prev) => prev.map((tk) => (tk.aibiTokenId === tokenId ? { ...tk, ...s } : tk)));
    setDetail((prev) => (prev && prev.aibiTokenId === tokenId ? { ...prev, ...s } : prev));
  }

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg font-black text-zinc-900 dark:text-zinc-50">{t("title")}</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
      </header>

      {error ? <AibiErrorBanner code={error.code} message={error.message} onClose={() => setError(null)} /> : null}

      {state === "loading" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
          ))}
        </div>
      ) : null}

      {state === "error" ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">
          {t("loadFailed")}
        </p>
      ) : null}

      {state === "ready" ? (
        <>
          {/* 供应看板（5.4.2） */}
          {supply ? (
            <div className="grid grid-cols-3 gap-2">
              <SupplyCell label={t("supply.minted")} value={supply.totalMinted} />
              <SupplyCell label={t("supply.burned")} value={supply.totalBurned} />
              <SupplyCell label={t("supply.current")} value={supply.currentSupply} />
            </div>
          ) : null}

          {/* 我的持有（5.4.1） */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {signedIn ? t("mineTitle", { count: mine.length }) : t("mineGuest")}
            </h3>
            {signedIn && mine.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-zinc-300 py-6 text-center text-xs text-zinc-400 dark:border-zinc-700">
                {t("mineEmpty")}
              </p>
            ) : null}
            {signedIn && mine.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {mine.map((tk) => (
                  <AibiCard key={tk.aibiTokenId} token={tk} locale={locale} onClick={() => setDetail(tk)} />
                ))}
              </div>
            ) : null}
          </div>

          {/* 可铸列表（5.4.3） */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("catalogTitle", { count: species.length })}
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {species.map((sp) => {
                const rv = rarityVisual(sp.rarityId);
                return (
                  <div
                    key={sp.id}
                    className="rounded-2xl border bg-white p-3 text-center dark:bg-zinc-900"
                    style={{ borderColor: rv.color }}
                  >
                    <span className="text-4xl leading-none">{aibiSpeciesEmoji(sp.id)}</span>
                    <p className="mt-1.5 truncate text-xs font-bold text-zinc-900 dark:text-zinc-100">
                      {isEn ? sp.nameEn : sp.nameZh}
                    </p>
                    <p className="mt-0.5 text-[11px] font-semibold" style={{ color: rv.color }}>
                      {rv.emoji} {isEn ? rv.rarity?.nameEn : rv.rarity?.nameZh}
                    </p>
                    <p className="mt-0.5 text-[10px] text-zinc-400">
                      {t("mintedCount", { count: sp.mintedCount })}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      {/* 详情弹窗（5.4.4：凭证编号 / 成长状态 / 互动入口） */}
      {detail ? (
        <AibiDetailModal token={detail} locale={locale} onClose={() => setDetail(null)} onStateChange={syncState} />
      ) : null}
    </section>
  );
}

function SupplyCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <p className="text-lg font-black tabular-nums text-zinc-900 dark:text-zinc-50">{value}</p>
      <p className="mt-0.5 text-[11px] text-zinc-400">{label}</p>
    </div>
  );
}

