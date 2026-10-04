"use client";

/**
 * BagClient · 背包页（Phase 5 · 5.3）
 *  - GET /api/bag/aibis 展示艾比列表（AibiCard，点击进详情弹窗，5.3.1/5.3.4）；
 *  - GET /api/bag/items 展示道具列表，按类型分组：卡包 / 消耗品（5.3.2/5.3.3）；
 *  - 卡包 → 「开包」跳 /packs/result；消耗品 → 选目标艾比后 POST /api/bag/use（5.3.5），
 *    成功后回写该艾比最新成长状态（与详情弹窗同一 onStateChange 通道）；
 *  - 登录门槛与 soul-cards 同策略：仅确认无 token / 401 时展示登录引导；
 *  - 加载骨架屏 + 按钮 loading；响应式网格。
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";
import { AibiCard } from "./aibi-card";
import { AibiChatButton } from "./aibi-chat-button";
import { AibiDetailModal } from "./aibi-detail-modal";
import { AibiErrorBanner } from "./aibi-error-banner";
import { FusionModal } from "./fusion-modal";
import { aibiFetch, AibiClientError } from "@/lib/aibi-client";
import { AIBI_MINT_DISCONTINUED } from "@/lib/aibi-flags";
import { aibiItemEmoji, type AibiTokenDto } from "@/lib/aibi-visual";

interface BagPackDto {
  packId: string;
  name: string;
  pricePoints: number | null;
  quantity: number;
}
interface BagItemDto {
  itemId: string;
  name: string;
  effect: string | null;
  pricePoints: number | null;
  quantity: number;
}
interface GrowthStateDto {
  personalityType: string;
  mood: string;
  affinity: number;
  energy: number;
  growthLevel: number;
  growthExp: number;
}

type LoadState = "loading" | "signedOut" | "ready" | "error";

export function BagClient() {
  const t = useTranslations("aibi.bag");
  const locale = useLocale();
  const router = useRouter();

  const [state, setState] = useState<LoadState>("loading");
  const [aibis, setAibis] = useState<AibiTokenDto[]>([]);
  const [packs, setPacks] = useState<BagPackDto[]>([]);
  const [items, setItems] = useState<BagItemDto[]>([]);
  const [detail, setDetail] = useState<AibiTokenDto | null>(null);
  const [useTarget, setUseTarget] = useState<BagItemDto | null>(null);
  const [fuseOpen, setFuseOpen] = useState(false);
  const [using, setUsing] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, i] = await Promise.all([
        aibiFetch<{ tokens: AibiTokenDto[] }>("/api/bag/aibis", { locale }),
        aibiFetch<{ packs: BagPackDto[]; items: BagItemDto[] }>("/api/bag/items", { locale }),
      ]);
      setAibis(a.tokens ?? []);
      setPacks(i.packs ?? []);
      setItems(i.items ?? []);
      setState("ready");
    } catch (e) {
      if (e instanceof AibiClientError && e.status === 401) setState("signedOut");
      else setState("error");
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 互动/用道具后回写某只艾比的最新成长状态（列表 + 弹窗同步） */
  function syncState(tokenId: string, s: GrowthStateDto) {
    setAibis((prev) => prev.map((tk) => (tk.aibiTokenId === tokenId ? { ...tk, ...s } : tk)));
    setDetail((prev) => (prev && prev.aibiTokenId === tokenId ? { ...prev, ...s } : prev));
  }

  /** 5.3.5 使用道具：消耗品 → 选中目标艾比 → POST /api/bag/use */
  async function consumeItem(itemId: string, tokenId: string) {
    setUsing(true);
    setError(null);
    try {
      const res = await aibiFetch<{ state: GrowthStateDto }>("/api/bag/use", {
        method: "POST",
        body: { itemId, tokenId },
        locale,
      });
      syncState(tokenId, res.state);
      setNotice(t("useSuccess"));
      setUseTarget(null);
      void load(); // 数量变化，重拉背包
    } catch (e) {
      if (e instanceof AibiClientError) setError({ code: e.code, message: e.message });
      else setError({ message: t("useFailed") });
    } finally {
      setUsing(false);
    }
  }

  /** 6.1 融合成功：素材已销毁 + 新艾比入库 → 整体重拉背包 */
  function onFused() {
    setNotice(t("fused"));
    void load();
  }

  /** 6.2 销毁成功：列表实时移除 + 关闭详情弹窗 */
  function onBurned(tokenId: string) {
    setAibis((prev) => prev.filter((tk) => tk.aibiTokenId !== tokenId));
    setDetail(null);
    setNotice(t("burned", { tokenId }));
  }

  /** 6.1.5 融合揭晓「查看详情」：关融合弹窗 → 重拉艾比列表 → 打开新艾比详情 */
  async function onViewFusedDetail(tokenId: string) {
    setFuseOpen(false);
    try {
      const a = await aibiFetch<{ tokens: AibiTokenDto[] }>("/api/bag/aibis", { locale });
      setAibis(a.tokens ?? []);
      const tk = (a.tokens ?? []).find((x) => x.aibiTokenId === tokenId);
      if (tk) setDetail(tk);
    } catch {
      /* 列表已由 onFused 触发整体刷新，失败时静默 */
    }
  }

  if (state === "signedOut") {
    return (
      <div className="rounded-3xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
        <p className="text-4xl">🎒</p>
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t("signInHint")}</p>
        <Link
          href="/login"
          className="mt-4 inline-block rounded-2xl bg-orange-500 px-6 py-2.5 text-sm font-bold text-white"
        >
          {t("signIn")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-black text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
      </header>

      {error ? <AibiErrorBanner code={error.code} message={error.message} onClose={() => setError(null)} /> : null}
      {notice ? (
        <p className="rounded-2xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}

      {state === "loading" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
          ))}
        </div>
      ) : null}

      {state === "error" ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-400 dark:border-zinc-700">
          {t("loadFailed")}
        </p>
      ) : null}

      {state === "ready" ? (
        <>
          {/* 我的艾比（5.3.1/5.3.4） */}
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t("aibisTitle", { count: aibis.length })}
              </h2>
              {/* 6.1.1 融合入口：持有 ≥2 只时可用；P0 概念收敛后停用（产物需铸新） */}
              {aibis.length >= 2 ? (
                <button
                  type="button"
                  onClick={() => setFuseOpen(true)}
                  disabled={AIBI_MINT_DISCONTINUED}
                  title={AIBI_MINT_DISCONTINUED ? t("fuseDiscontinued") : undefined}
                  className="shrink-0 rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-500 px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  🧬 {t("fuse")}
                </button>
              ) : null}
            </div>
            {aibis.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-zinc-300 py-8 text-center text-xs text-zinc-400 dark:border-zinc-700">
                {t("aibisEmpty")}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {aibis.map((tk) => (
                  <div key={tk.aibiTokenId} className="flex flex-col gap-1.5">
                    <AibiCard
                      token={tk}
                      locale={locale}
                      showGrowth
                      onClick={() => setDetail(tk)}
                    />
                    {/* Aibi ↔ 聊天入口（方案 a）：有线程直接进，无线程幂等创建 */}
                    <AibiChatButton aibiTokenId={tk.aibiTokenId} threadId={tk.threadId} />
                  </div>
                ))}
              </div>
            )}
          </section>


          {/* 道具分组：卡包（5.3.2/5.3.3） */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("packsTitle", { count: packs.reduce((s, p) => s + p.quantity, 0) })}
            </h2>
            {packs.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-zinc-300 py-6 text-center text-xs text-zinc-400 dark:border-zinc-700">
                {t("packsEmpty")}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {packs.map((p) => (
                  <div
                    key={p.packId}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="text-3xl">🎴</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">{p.name}</p>
                        <p className="text-[11px] text-zinc-400">×{p.quantity}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push(`/packs/result?packId=${encodeURIComponent(p.packId)}`)}
                      className="shrink-0 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2 text-xs font-bold text-white"
                    >
                      {t("openPack")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 道具分组：消耗品（5.3.5） */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("itemsTitle", { count: items.reduce((s, i) => s + i.quantity, 0) })}
            </h2>
            {items.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-zinc-300 py-6 text-center text-xs text-zinc-400 dark:border-zinc-700">
                {t("itemsEmpty")}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {items.map((it) => (
                  <div
                    key={it.itemId}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="text-3xl">{aibiItemEmoji(it.itemId)}</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">{it.name}</p>
                        <p className="truncate text-[11px] text-zinc-400">
                          {it.effect ?? ""} · ×{it.quantity}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUseTarget(it)}
                      disabled={aibis.length === 0}
                      className="shrink-0 rounded-xl border border-emerald-300 px-4 py-2 text-xs font-bold text-emerald-600 disabled:opacity-40 dark:border-emerald-700 dark:text-emerald-400"
                    >
                      {t("useItem")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}


      {/* 融合弹窗（6.1） */}
      {fuseOpen ? (
        <FusionModal
          aibis={aibis}
          locale={locale}
          onClose={() => setFuseOpen(false)}
          onFused={onFused}
          onViewDetail={(id) => void onViewFusedDetail(id)}
        />
      ) : null}

      {/* 艾比详情弹窗（含互动 5.5 + 销毁 6.2） */}
      {detail ? (
        <AibiDetailModal
          token={detail}
          locale={locale}
          onClose={() => setDetail(null)}
          onStateChange={syncState}
          onBurned={onBurned}
        />
      ) : null}

      {/* 用道具：选择目标艾比 */}
      {useTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center"
          onClick={() => !using && setUseTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white p-4 shadow-2xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {t("pickTarget", { item: useTarget.name })}
            </h3>
            <p className="mt-1 text-xs text-zinc-400">{useTarget.effect ?? ""}</p>
            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
              {aibis.map((tk) => (
                <button
                  key={tk.aibiTokenId}
                  type="button"
                  disabled={using}
                  onClick={() => void consumeItem(useTarget.itemId, tk.aibiTokenId)}
                  className="flex w-full items-center justify-between gap-2 rounded-2xl border border-zinc-200 px-3 py-2.5 text-left text-sm transition hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-zinc-900 dark:text-zinc-100">
                      {tk.species ? (locale === "en" ? tk.species.nameEn : tk.species.nameZh) : tk.speciesId}
                    </span>
                    <span className="block text-[11px] text-zinc-400">
                      Lv.{tk.growthLevel ?? 1} · ⚡{tk.energy ?? 0} · 💗{tk.affinity ?? 0}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    {using ? t("using") : t("useConfirm")}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={using}
              onClick={() => setUseTarget(null)}
              className="mt-3 w-full rounded-2xl border border-zinc-200 py-2 text-xs font-semibold text-zinc-500 dark:border-zinc-700"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

