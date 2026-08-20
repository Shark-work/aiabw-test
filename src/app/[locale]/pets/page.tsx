"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";

import { PetAvatar } from "@/components/PetAvatar";
import { PetDescription } from "@/components/pet-description";
import {
  formatAdoptionImprint,
  formatGenealogy,
  getRarityMeta,
  petStaleState,
  shouldCelebrate,
} from "@/lib/pet-status";

type CatalogPet = {
  id: string;
  speciesId: string;
  speciesName: string;
  category: string;
  imageUrl: string;
  traits: { element?: string; rarity?: string; personality?: string; [k: string]: unknown };
  generation: number;
  customDescription: string | null;
  defaultDescription: string;
  owned: boolean;
  adoptedAt: string | null;
  lastInteractionTime: string | null;
  parentIds: unknown;
};

const ELEMENTS = ["fire", "water", "earth", "air"];
const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];

export default function PetsCatalogPage() {
  const t = useTranslations("petsCatalog");
  const router = useRouter();
  const [pets, setPets] = useState<CatalogPet[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [element, setElement] = useState("");
  const [rarity, setRarity] = useState("");
  const [mine, setMine] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [synthesizing, setSynthesizing] = useState(false);
  const [toast, setToast] = useState("");
  // 稀缺性：高稀有度合成 → 全屏高光诞生动画
  const [celebrate, setCelebrate] = useState<{ pet: CatalogPet; rarity: string } | null>(null);
  const [interactingId, setInteractingId] = useState<string | null>(null);
  const locale = useLocale();
  const cardRef = useRef<HTMLCanvasElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ limit: "60" });
      if (category) qs.set("category", category);
      if (element) qs.set("element", element);
      if (rarity) qs.set("rarity", rarity);
      if (mine) qs.set("mine", "1");
      const res = await fetch(`/api/pets/catalog?${qs.toString()}`);
      const data = await res.json();
      if (data?.ok) {
        setPets(data.pets ?? []);
        if (data.categories?.length) setCategories(data.categories);
      } else {
        setError(data?.error ?? t("synthesizeFailed"));
      }
    } catch {
      setError(t("synthesizeFailed"));
    } finally {
      setLoading(false);
    }
  }, [category, element, rarity, mine, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSynthesize = async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) {
      router.push("/login?redirect=/pets");
      return;
    }
    setSynthesizing(true);
    try {
      const res = await fetch("/api/pets/synthesize", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.ok) {
        setToast(t("synthesizeOk"));
        // 稀缺性：高稀有度合成 → 全屏“高光诞生”动画
        const rar = String(data.pet?.traits?.rarity ?? "");
        if (data.pet && shouldCelebrate(rar)) {
          setCelebrate({ pet: data.pet, rarity: rar });
          setTimeout(() => setCelebrate(null), 3000);
        }
        await load();
      } else {
        setError(data?.error ?? t("synthesizeFailed"));
      }
    } catch {
      setError(t("synthesizeFailed"));
    } finally {
      setSynthesizing(false);
      setTimeout(() => setToast(""), 3000);
    }
  };

  // 损失厌恶：喂食/互动 → 刷新 last_interaction_time，滤镜消失
  const handleInteract = async (pet: CatalogPet) => {
    const token = localStorage.getItem("aiabw_token");
    if (!token || interactingId) return;
    setInteractingId(pet.id);
    try {
      const res = await fetch(`/api/pets/${encodeURIComponent(pet.id)}/interact`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.ok) {
        setPets((prev) =>
          prev.map((p) =>
            p.id === pet.id ? { ...p, lastInteractionTime: data.lastInteractionTime ?? new Date().toISOString() } : p,
          ),
        );
      } else {
        setError(data?.error ?? t("synthesizeFailed"));
      }
    } catch {
      setError(t("synthesizeFailed"));
    } finally {
      setInteractingId(null);
    }
  };

  // 炫耀心理：生成宠物名片（canvas 合成 → PNG 下载）
  const handleShare = async (pet: CatalogPet) => {
    const canvas = cardRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = 720;
    const H = 960;
    canvas.width = W;
    canvas.height = H;

    // 背景
    const meta = getRarityMeta(String(pet.traits.rarity ?? ""));
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "#fff7ed");
    grad.addColorStop(1, "#fdf2f8");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 头像（圆形裁切）
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = pet.imageUrl;
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, 220, 120, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#ffe4d6";
    ctx.fillRect(W / 2 - 120, 100, 240, 240);
    if (img.width) ctx.drawImage(img, W / 2 - 120, 100, 240, 240);
    ctx.restore();
    ctx.strokeStyle = "#fb923c";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(W / 2, 220, 120, 0, Math.PI * 2);
    ctx.stroke();

    // 稀有度徽章
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.textAlign = "center";
    const badge = `${meta.emoji} ${locale === "en" ? meta.labelEn : meta.labelZh}`;
    ctx.fillStyle = "#7c3aed";
    ctx.fillText(badge, W / 2, 400);

    // 名字 + ID（禀赋效应）
    ctx.font = "bold 40px system-ui, sans-serif";
    ctx.fillStyle = "#18181b";
    ctx.fillText(pet.speciesName, W / 2, 460);
    ctx.font = "24px monospace";
    ctx.fillStyle = "#f97316";
    ctx.fillText(pet.id, W / 2, 505);

    // 专属印记 + 族谱
    ctx.font = "20px system-ui, sans-serif";
    ctx.fillStyle = "#52525b";
    const imprint = formatAdoptionImprint(pet.adoptedAt, locale);
    if (imprint) ctx.fillText(imprint, W / 2, 545);
    const lineage = formatGenealogy(pet.parentIds);
    if (lineage) ctx.fillText(lineage, W / 2, 580);

    // 介绍（自定义高亮）
    const desc = pet.customDescription ?? pet.defaultDescription;
    ctx.font = "22px system-ui, sans-serif";
    ctx.fillStyle = pet.customDescription ? "#9a3412" : "#3f3f46";
    const words = desc.slice(0, 50);
    // 手动折行
    const lines: string[] = [];
    let cur = "";
    for (const ch of words) {
      if (ctx.measureText(cur + ch).width > W - 120) {
        lines.push(cur);
        cur = ch;
      } else {
        cur += ch;
      }
    }
    if (cur) lines.push(cur);
    lines.slice(0, 4).forEach((line, i) => {
      ctx.fillText(line, W / 2, 640 + i * 32);
    });

    // 页脚
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillStyle = "#a1a1aa";
    ctx.fillText("Aibi World · aiabw.com", W / 2, H - 40);

    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pet.speciesName}-${pet.id.replace("#", "")}.png`;
    a.click();
    setToast(t("cardDownloaded"));
    setTimeout(() => setToast(""), 3000);
  };

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs transition ${
      active ? "bg-orange-500 text-white" : "bg-white text-zinc-600 border border-zinc-200 hover:border-orange-300"
    }`;

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">{t("title")}</h1>
            <p className="text-xs text-zinc-500">{t("subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMine((v) => !v)} className={chip(mine)}>
              {t("mine")}
            </button>
            <button
              type="button"
              onClick={() => void handleSynthesize()}
              disabled={synthesizing}
              className="rounded-full bg-violet-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-violet-600 disabled:opacity-60"
            >
              {synthesizing ? "…" : t("synthesize")}
            </button>
          </div>
        </div>

        {toast && (
          <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-sm text-emerald-700">
            {toast}
          </div>
        )}

        {/* 字典分类导航 */}
        <div className="mb-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setCategory("")} className={chip(!category)}>
            {t("all")}
          </button>
          {categories.map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} className={chip(category === c)}>
              {c}
            </button>
          ))}
        </div>

        {/* 基因筛选（GIN 索引） */}
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-400">element</span>
            {ELEMENTS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setElement(element === e ? "" : e)}
                className={chip(element === e)}
              >
                {e}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-400">rarity</span>
            {RARITIES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRarity(rarity === r ? "" : r)}
                className={chip(rarity === r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {loading && <p className="py-10 text-center text-sm text-zinc-400">{t("loading")}</p>}
        {error && <p className="py-10 text-center text-sm text-red-500">{error}</p>}
        {!loading && !error && pets.length === 0 && (
          <p className="py-16 text-center text-sm text-zinc-400">{t("empty")}</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pets.map((pet) => {
            const rarityMeta = getRarityMeta(String(pet.traits.rarity ?? ""));
            const st = petStaleState(pet.lastInteractionTime, pet.adoptedAt);
            const imprint = formatAdoptionImprint(pet.adoptedAt, locale);
            const lineage = formatGenealogy(pet.parentIds);
            const stale = st.stale && pet.owned;
            return (
              <div
                key={pet.id}
                className={`relative rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm backdrop-blur transition ${
                  stale ? "grayscale" : ""
                }`}
              >
                {/* 状态提示：损失厌恶 */}
                {stale && (
                  <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-zinc-800/80 px-2 py-0.5 text-[11px] font-medium text-white">
                    {st.level === "lonely" ? "💧" : "🍖"} {t(st.level === "lonely" ? "lonely" : "hungry")}
                    <span className="opacity-70">· {t("daysAgo", { n: st.daysSince })}</span>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <PetAvatar
                    src={pet.imageUrl}
                    alt={pet.speciesName}
                    className="h-14 w-14 rounded-full border-2 border-orange-200 bg-orange-50 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-900">{pet.speciesName}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${rarityMeta.badgeClass}`}
                      >
                        {rarityMeta.emoji} {locale === "en" ? rarityMeta.labelEn : rarityMeta.labelZh}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-zinc-500">
                      <span className="rounded bg-orange-50 px-1 py-0.5">⚡{pet.traits.element ?? "?"}</span>
                      <span className="rounded bg-violet-50 px-1 py-0.5">❤️{pet.traits.personality ?? "?"}</span>
                    </div>
                    {/* 禀赋效应：唯一 ID + 孕育印记 + 族谱 */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-400">
                      <span className="font-mono font-medium text-orange-500">{pet.id}</span>
                      <span>第 {pet.generation} 代</span>
                      {pet.owned && imprint && <span className="text-emerald-600">· {imprint}</span>}
                      {pet.owned && lineage && <span>· {lineage}</span>}
                    </div>
                  </div>
                </div>

                <div className="mt-3">
                  <PetDescription
                    petId={pet.id}
                    customDescription={pet.customDescription}
                    defaultDescription={pet.defaultDescription}
                    owned={pet.owned}
                    onSaved={(desc) => {
                      const wasNull = pet.customDescription === null;
                      setPets((prev) =>
                        prev.map((p) => (p.id === pet.id ? { ...p, customDescription: desc } : p)),
                      );
                      // 沉没成本：第一次写下专属介绍 → 灵魂 Toast
                      if (wasNull && desc) {
                        setToast(t("firstSoul"));
                        setTimeout(() => setToast(""), 3000);
                      }
                    }}
                  />
                </div>

                {/* 操作区：互动（损失厌恶）+ 名片（炫耀心理） */}
                {pet.owned && (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={interactingId === pet.id}
                      onClick={() => void handleInteract(pet)}
                      className="flex-1 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-600 disabled:opacity-60"
                    >
                      {interactingId === pet.id ? t("interacting") : t("interact")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleShare(pet)}
                      className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-200"
                    >
                      {t("shareCard")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 名片合成用的隐藏画布 */}
        <canvas ref={cardRef} className="hidden" aria-hidden />

        {/* 稀缺性：高稀有度合成 → 全屏“高光诞生”动画 */}
        {celebrate && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden">
            <div
              className={`absolute inset-0 animate-pulse bg-gradient-to-br ${getRarityMeta(celebrate.rarity).glow}`}
            />
            <div className="relative z-10 flex flex-col items-center gap-4 text-center">
              <div className="text-6xl">✨</div>
              <h2 className="text-3xl font-bold text-white drop-shadow-lg">{t("birth")}</h2>
              <PetAvatar
                src={celebrate.pet.imageUrl}
                alt={celebrate.pet.speciesName}
                className="h-32 w-32 rounded-full border-4 border-white bg-white/60 object-cover shadow-2xl"
              />
              <p className="text-xl font-semibold text-white drop-shadow">
                {celebrate.pet.speciesName} · <span className="font-mono">{celebrate.pet.id}</span>
              </p>
              <span
                className={`rounded-full px-4 py-1 text-sm font-bold text-white ${getRarityMeta(celebrate.rarity).badgeClass}`}
              >
                {getRarityMeta(celebrate.rarity).emoji}{" "}
                {locale === "en" ? getRarityMeta(celebrate.rarity).labelEn : getRarityMeta(celebrate.rarity).labelZh}
              </span>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
