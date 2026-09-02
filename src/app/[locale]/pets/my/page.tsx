"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

import {
  AggregatedPetCard,
  type AggGroup,
  type AggPet,
} from "@/components/pets/aggregated-pet-card";
import { SubSelectionModal } from "@/components/pets/sub-selection-modal";
import { FusionOverlay } from "@/components/pets/fusion-overlay";
import { RedeemShopModal } from "@/components/pets/redeem-shop-modal";

/** 仓库上限（资产管理层显示持有数/上限） */
const STORAGE_LIMIT = 100;

type Outcome = { pet: AggPet & { defaultDescription?: string }; critical: boolean };

export default function PetCollectionPage() {
  const t = useTranslations("petsCatalog");
  const tc = useTranslations("common");
  const tm = useTranslations("myPets");
  const tp = useTranslations("points");
  const router = useRouter();

  const [pets, setPets] = useState<AggPet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showOnlyEvolvable, setShowOnlyEvolvable] = useState(false);
  const [openGroup, setOpenGroup] = useState<AggGroup | null>(null);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [phase, setPhase] = useState<"idle" | "fusing" | "result">("idle");
  const [fusionSources, setFusionSources] = useState<AggPet[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [toast, setToast] = useState("");
  const [points, setPoints] = useState(0);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState("");
  const [redeemResult, setRedeemResult] = useState<{
    id: string;
    speciesName: string;
    imageUrl: string;
    traits: { rarity?: string };
  } | null>(null);
  const [releasing, setReleasing] = useState(false);
  const outcomeRef = useRef<Outcome | null>(null);
  useEffect(() => {
    outcomeRef.current = outcome;
  }, [outcome]);

  const load = useCallback(async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/pets/catalog?mine=1&limit=100", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.ok) setPets(data.pets ?? []);
      else setError(data?.error ?? t("synthesizeFailed"));
    } catch {
      setError(t("synthesizeFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // 未登录跳转 + 首屏加载 + 拉积分
  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem("aiabw_token")) {
      router.push("/login?redirect=/pets/my");
    }
  }, [router]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d.user) setPoints(d.user.points ?? 0);
      })
      .catch(() => {});
  }, []);

  // 按（物种, 稀有度）聚合
  const groups = useMemo(() => {
    const map = new Map<string, AggGroup>();
    for (const p of pets) {
      const r = String(p.traits.rarity ?? "common");
      const key = `${p.speciesId}::${r}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          speciesId: p.speciesId,
          speciesName: p.speciesName,
          rarity: r,
          imageUrl: p.imageUrl,
          pets: [],
        });
      }
      map.get(key)!.pets.push(p);
    }
    return Array.from(map.values()).sort((a, b) => b.pets.length - a.pets.length);
  }, [pets]);

  const visibleGroups = showOnlyEvolvable ? groups.filter((g) => g.pets.length >= 3) : groups;

  // 互斥：一旦勾选某组宠物，其他组置灰
  const checkedGroupKey = useMemo(() => {
    if (!checkedIds.length) return null;
    const p0 = pets.find((p) => p.id === checkedIds[0]);
    return p0 ? `${p0.speciesId}::${String(p0.traits.rarity ?? "common")}` : null;
  }, [checkedIds, pets]);
  const locked = checkedGroupKey !== null;

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 3 ? prev : [...prev, id],
    );
  };

  const openSubSelection = (g: AggGroup) => {
    if (locked && checkedGroupKey !== g.key) return; // 互斥
    setOpenGroup(g);
  };

  // 放生（删除）—— 二次确认已在子选择层完成
  const handleRelease = async (id: string) => {
    const token = localStorage.getItem("aiabw_token");
    if (!token || releasing) return;
    setReleasing(true);
    try {
      const res = await fetch("/api/pets/release", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ petIds: [id] }),
      });
      const data = await res.json();
      if (data?.ok) {
        setToast(t("releasedOk"));
        setTimeout(() => setToast(""), 2500);
        setCheckedIds((prev) => prev.filter((x) => x !== id));
        await load();
      } else {
        setError(data?.error ?? t("evolveFail"));
      }
    } catch {
      setError(t("evolveFail"));
    } finally {
      setReleasing(false);
    }
  };

  // 合成：仪式动画 + evolve API（幸运暴击 15%）
  const handleFuse = async () => {
    if (checkedIds.length !== 3 || phase !== "idle") return;
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    setPhase("fusing");
    setOutcome(null);
    setFusionSources(checkedIds.map((id) => pets.find((p) => p.id === id)).filter(Boolean) as AggPet[]);
    try {
      const res = await fetch("/api/pets/evolve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ petIds: checkedIds }),
      });
      const data = await res.json();
      if (data?.ok) {
        setOutcome({ pet: data.pet, critical: !!data.critical });
        setToast(t("evolveSuccess"));
        setTimeout(() => setToast(""), 3000);
        void load();
      } else {
        setError(data?.error ?? t("evolveFail"));
      }
    } catch {
      setError(t("evolveFail"));
    }
    // 仪式动画完整播放后再揭晓结果（无论 API 快慢都先等动画）
    await new Promise((r) => setTimeout(r, 1900));
    setPhase(outcomeRef.current ? "result" : "idle");
  };

  const keepInBag = () => {
    setPhase("idle");
    setOutcome(null);
    setCheckedIds([]);
    setOpenGroup(null);
  };

  // 积分兑换（盲盒）
  const handleRedeem = async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token || redeeming) return;
    setRedeeming(true);
    setRedeemMsg("");
    setRedeemResult(null);
    try {
      const res = await fetch("/api/points/redeem-pet", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.ok) {
        setPoints(data.points ?? 0);
        setRedeemResult(data.pet);
        setRedeemMsg(tp("redeemOk"));
        void load();
      } else {
        setRedeemMsg(data?.error ?? tp("redeemFail"));
      }
    } catch {
      setRedeemMsg(tp("redeemFail"));
    } finally {
      setRedeeming(false);
    }
  };

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition ${
      active ? "bg-violet-500 text-white" : "bg-white text-zinc-600 border border-zinc-200 hover:border-violet-300"
    }`;

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 pb-28 sm:p-6">
      <div className="mx-auto max-w-4xl">
        {/* 顶部状态栏：持有数/上限 + 操作入口 */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">{tm("title")}</h1>
            <p className="mt-0.5 text-xs text-zinc-500">
              {t("storageLabel")} {pets.length} / {STORAGE_LIMIT} · {t("storageLimit")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/pets"
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
            >
              ← {t("backToCatalog")}
            </Link>
            <button
              type="button"
              onClick={() => setRedeemOpen(true)}
              className="rounded-full bg-violet-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-600"
            >
              {t("redeemShop")}
            </button>
          </div>
        </div>

        {toast && (
          <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-sm text-emerald-700">
            {toast}
          </div>
        )}

        {/* 筛选器：仅显示可合成 */}
        <div className="mb-4 flex items-center gap-2">
          <button type="button" onClick={() => setShowOnlyEvolvable((v) => !v)} className={chip(showOnlyEvolvable)}>
            {t("onlyEvolvable")}
          </button>
        </div>

        {loading && <p className="py-10 text-center text-sm text-zinc-400">{tc("loading")}</p>}
        {error && <p className="py-10 text-center text-sm text-red-500">{error}</p>}
        {!loading && !error && visibleGroups.length === 0 && (
          <p className="py-16 text-center text-sm text-zinc-400">
            {showOnlyEvolvable ? t("noEvolvable") : t("empty")}
          </p>
        )}

        {/* 聚合卡片网格 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visibleGroups.map((g, i) => (
            <AggregatedPetCard
              key={g.key}
              group={g}
              delay={i * 0.3}
              disabled={locked && checkedGroupKey !== g.key}
              onSelect={openSubSelection}
            />
          ))}
        </div>
      </div>

      {/* 底部操作台：勾选满 3 只滑出 */}
      {checkedIds.length === 3 && phase === "idle" && (
        <div className="fixed inset-x-0 bottom-0 z-40">
          <div className="mx-auto max-w-md rounded-t-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-3 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-white">
                {t("selectedCount", {
                  count: 3,
                  name: checkedGroupKey ? groups.find((g) => g.key === checkedGroupKey)?.speciesName ?? "" : "",
                })}
              </span>
              <button
                type="button"
                onClick={() => void handleFuse()}
                className="rounded-full bg-white px-5 py-2 text-sm font-bold text-violet-700 shadow transition hover:scale-105"
              >
                {t("fuseNow")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 子选择层（勾选 3 只 + 放生） */}
      {openGroup && phase === "idle" && (
        <SubSelectionModal
          group={openGroup}
          checkedIds={checkedIds}
          onToggle={toggleCheck}
          onRelease={(id) => void handleRelease(id)}
          onClose={() => {
            setOpenGroup(null);
            if (checkedIds.length < 3) setCheckedIds([]);
          }}
        />
      )}

      {/* 合成仪式 + 结果页 */}
      {phase !== "idle" && (
        <FusionOverlay
          phase={phase}
          sources={fusionSources}
          outcome={outcome}
          onKeep={keepInBag}
          onContinue={() => {
            setPhase("idle");
            setOutcome(null);
            setCheckedIds([]);
            setOpenGroup(null);
          }}
        />
      )}

      {/* 积分兑换所 */}
      {redeemOpen && (
        <RedeemShopModal
          points={points}
          redeeming={redeeming}
          redeemMsg={redeemMsg}
          redeemResult={redeemResult}
          onRedeem={() => void handleRedeem()}
          onDeposit={() => {
            setRedeemOpen(false);
            setRedeemResult(null);
            setRedeemMsg("");
            void load();
          }}
          onClose={() => {
            setRedeemOpen(false);
            setRedeemResult(null);
          }}
        />
      )}
    </main>
  );
}



