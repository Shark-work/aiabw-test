"use client";

/**
 * NfrGalleryPanel · 收藏中心「数字藏品」Tab（2026-10-06 收藏中心三 Tab 重构）
 *  - 数据源：GET /api/gallery?mine=1（digital_collectibles JOIN user_collectibles，
 *    按当前登录用户过滤持有，API 返回本地化 name/description 与 holdings 计数）；
 *  - 登录策略与 SoulCardsClient 一致：localStorage aiabw_token + Authorization: Bearer，
 *    无 token / 401 → 登录引导；
 *  - 空状态引导去盲盒广场（NFR 当前唯一用户可见获取入口）。
 *  - 2026-10-08 结晶/转赠入口：卡片操作区挂「结晶」「转赠」按钮；操作作用于
 *    user_collectibles 个体，实例数据来自 GET /api/pets/collectibles（定义级
 *    /api/gallery 契约保持不变，实例加载失败仅隐藏操作按钮不阻断列表）。
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { getRarityMeta } from "@/lib/pet-status";
import { NfrBreedModal } from "@/components/collection/nfr-breed-modal";
import { NfrTransferModal } from "@/components/collection/nfr-transfer-modal";
import type { CollectibleInstance } from "@/components/collection/nfr-shared";

type GalleryItem = {
  id: string;
  speciesId: string;
  name: string;
  category: string;
  rarity: string;
  element: string | null;
  habitat: string | null;
  imageUrl: string;
  totalSupply: number;
  minted: number;
  description: string | null;
  owned: boolean;
  holdings: number;
};

type LoadState = "loading" | "signedOut" | "ready" | "error";

export function NfrGalleryPanel() {
  const t = useTranslations("collection.nfr");
  const locale = useLocale();
  const isEn = locale === "en";

  const [state, setState] = useState<LoadState>("loading");
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [instances, setInstances] = useState<CollectibleInstance[]>([]);
  const [modal, setModal] = useState<{ kind: "breed" | "transfer"; item: GalleryItem } | null>(null);

  const load = useCallback(async () => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("aiabw_token") : null;
    if (!token) {
      setState("signedOut");
      return;
    }
    try {
      const res = await fetch("/api/gallery?mine=1", {
        headers: { Authorization: `Bearer ${token}`, "x-locale": locale },
      });
      if (res.status === 401) {
        setState("signedOut");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        items?: GalleryItem[];
      };
      if (!res.ok || !data.ok) {
        setState("error");
        return;
      }
      setItems(data.items ?? []);
      // 个体实例（结晶/转赠操作对象）：加载失败仅隐藏操作按钮，不阻断定义级列表
      try {
        const res2 = await fetch("/api/pets/collectibles", {
          headers: { Authorization: `Bearer ${token}`, "x-locale": locale },
        });
        const data2 = (await res2.json().catch(() => ({}))) as {
          ok?: boolean;
          items?: CollectibleInstance[];
        };
        setInstances(res2.ok && data2.ok ? (data2.items ?? []) : []);
      } catch {
        setInstances([]);
      }
      setState("ready");
    } catch {
      setState("error");
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-5">
      {state === "loading" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800"
            />
          ))}
        </div>
      ) : null}

      {state === "signedOut" ? (
        <div className="rounded-2xl border border-zinc-200 bg-white/70 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/60">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("signInHint")}</p>
          <Link
            href="/login"
            className="mt-4 inline-block rounded-full bg-orange-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-orange-600"
          >
            {t("signIn")}
          </Link>
        </div>
      ) : null}

      {state === "error" ? (
        <p className="py-10 text-center text-sm text-red-600">{t("loadFailed")}</p>
      ) : null}

      {state === "ready" && items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/50 p-8 text-center dark:border-violet-800 dark:bg-violet-950/30">
          <p className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
            {t("emptyTitle")}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
            {t("emptyDesc")}
          </p>
          <Link
            href="/blindbox"
            className="mt-4 inline-block rounded-full bg-violet-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-600"
          >
            {t("emptyCta")}
          </Link>
        </div>
      ) : null}

      {state === "ready" && items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((it) => {
            const meta = getRarityMeta(it.rarity);
            const myInstances = instances.filter((i) => i.collectibleId === it.id);
            return (
              <div
                key={it.id}
                className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                <div className="relative aspect-square bg-zinc-50 dark:bg-zinc-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={it.imageUrl}
                    alt={it.name}
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                  <span
                    className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}
                  >
                    {meta.emoji} {isEn ? meta.labelEn : meta.labelZh}
                  </span>
                </div>
                <div className="space-y-1.5 p-3">
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    {it.name}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                      {t("holdings", { count: it.holdings })}
                    </span>
                    <span>
                      {it.totalSupply > 0
                        ? t("supply", { minted: it.minted, total: it.totalSupply })
                        : `${it.minted} · ${t("unlimited")}`}
                    </span>
                  </div>
                  {myInstances.length > 0 ? (
                    <div className="flex gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => setModal({ kind: "breed", item: it })}
                        className="flex-1 rounded-full bg-violet-500 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-violet-600"
                      >
                        🧬 {t("actions.breed")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setModal({ kind: "transfer", item: it })}
                        className="flex-1 rounded-full border border-violet-200 bg-white px-2 py-1 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-50 dark:border-violet-700 dark:bg-zinc-900 dark:text-violet-300 dark:hover:bg-violet-950/40"
                      >
                        🎁 {t("actions.transfer")}
                      </button>
                      {/* Phase 5：付费推荐位入口（跳排行榜页自动开推广弹窗，预选第一只持有实例） */}
                      <Link
                        href={`/leaderboard?promote=${myInstances[0].id}`}
                        data-testid="nfr-promote-link"
                        className="flex-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-center text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                      >
                        📣 {t("actions.promote")}
                      </Link>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {modal?.kind === "breed" ? (
        <NfrBreedModal
          item={modal.item}
          allInstances={instances}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            void load();
          }}
        />
      ) : null}
      {modal?.kind === "transfer" ? (
        <NfrTransferModal
          item={modal.item}
          instances={instances.filter((i) => i.collectibleId === modal.item.id)}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            void load();
          }}
        />
      ) : null}
    </section>
  );
}
