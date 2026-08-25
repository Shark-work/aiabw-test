"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { PetAvatar } from "@/components/PetAvatar";
import { getRarityMeta } from "@/lib/pet-status";

type PetRank = {
  rank: number;
  id: string;
  collectibleId: string;
  hashId: string;
  ownerId: string;
  ownerEmail: string;
  name: string;
  rarity: string;
  element: string | null;
  generation: number;
  power: number;
  imageUrl: string;
};

type BreederRank = {
  rank: number;
  ownerId: string;
  ownerEmail: string;
  mintedCount: number;
};

const RANK_MEDALS = ["👑", "🥈", "🥉"];
const RANK_TOP_CLASS = [
  "border-amber-400 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-100 shadow-md",
  "border-zinc-300 bg-gradient-to-r from-zinc-50 to-slate-100 shadow-sm",
  "border-orange-300 bg-gradient-to-r from-orange-50 to-rose-50 shadow-sm",
];

/**
 * 排行榜面板（图鉴页「排行榜」Tab）：
 *  - 「全服最强宠物榜」Top 20：按综合战力分（稀有度×代数+元素）排序；
 *  - 「本周繁育达人榜」Top 20：本周铸造新藏品最多；
 *  - 前三名展示皇冠徽章 + 光效渐变背景。
 */
export function LeaderboardPanel() {
  const t = useTranslations("leaderboard");
  const locale = useLocale();
  const [type, setType] = useState<"pets" | "breeders">("pets");
  const [pets, setPets] = useState<PetRank[]>([]);
  const [breeders, setBreeders] = useState<BreederRank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    fetch(`/api/leaderboard?type=${type}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.ok) {
          if (type === "pets") setPets(d.items ?? []);
          else setBreeders(d.items ?? []);
        } else {
          setError(t("loadFailed"));
        }
      })
      .catch(() => alive && setError(t("loadFailed")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [type, t]);

  const tabCls = (active: boolean) =>
    `rounded-full px-4 py-1.5 text-sm font-semibold transition ${
      active ? "bg-orange-500 text-white shadow" : "bg-white text-zinc-600 hover:bg-orange-50"
    }`;

  return (
    <div className="w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm backdrop-blur">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-zinc-800">🏆 {t("title")}</h3>
        <div className="flex gap-1.5">
          <button type="button" className={tabCls(type === "pets")} onClick={() => setType("pets")}>
            {t("tabPets")}
          </button>
          <button type="button" className={tabCls(type === "breeders")} onClick={() => setType("breeders")}>
            {t("tabBreeders")}
          </button>
        </div>
      </div>

      {loading && <p className="py-6 text-center text-sm text-zinc-400">{t("loading")}</p>}
      {error && <p className="py-6 text-center text-sm text-red-500">{error}</p>}
      {!loading && !error && (
        <ol className="space-y-1.5">
          {type === "pets"
            ? pets.map((p) => {
                const meta = getRarityMeta(p.rarity);
                const top = p.rank <= 3;
                return (
                  <li
                    key={p.id}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                      top ? RANK_TOP_CLASS[p.rank - 1] : "border-zinc-100 bg-white"
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        top ? "text-amber-500" : "text-zinc-400"
                      }`}
                    >
                      {RANK_MEDALS[p.rank - 1] ?? p.rank}
                    </span>
                    <PetAvatar
                      src={p.imageUrl}
                      alt={p.name}
                      className="h-9 w-9 shrink-0 rounded-full border border-orange-200 bg-orange-50 object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-zinc-800">{p.name}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}>
                          {meta.emoji} {locale === "en" ? meta.labelEn : meta.labelZh}
                        </span>
                        {top && <span className="text-xs">👑</span>}
                      </div>
                      <div className="truncate text-[11px] text-zinc-400">
                        {t("owner", { email: p.ownerEmail })} · {t("generation", { gen: p.generation })} · ⚡{p.element ?? "?"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-bold text-orange-600">{p.power.toLocaleString()}</div>
                      <div className="text-[10px] text-zinc-400">{t("power")}</div>
                    </div>
                  </li>
                );
              })
            : breeders.map((b) => {
                const top = b.rank <= 3;
                return (
                  <li
                    key={b.ownerId}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                      top ? RANK_TOP_CLASS[b.rank - 1] : "border-zinc-100 bg-white"
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        top ? "text-amber-500" : "text-zinc-400"
                      }`}
                    >
                      {RANK_MEDALS[b.rank - 1] ?? b.rank}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-800">
                      {b.ownerEmail} {top && <span className="text-xs">👑</span>}
                    </span>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-bold text-violet-600">{b.mintedCount}</div>
                      <div className="text-[10px] text-zinc-400">{t("minted")}</div>
                    </div>
                  </li>
                );
              })}
          {/* __PART2__ */}
        </ol>
      )}
    </div>
  );
}
