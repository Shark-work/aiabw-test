"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

import { PetAvatar } from "@/components/PetAvatar";
import { PetDescription } from "@/components/pet-description";

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
          {pets.map((pet) => (
            <div
              key={pet.id}
              className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm backdrop-blur"
            >
              <div className="flex items-center gap-3">
                <PetAvatar
                  src={pet.imageUrl}
                  alt={pet.speciesName}
                  className="h-14 w-14 rounded-full border-2 border-orange-200 bg-orange-50 object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-zinc-900">{pet.speciesName}</span>
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
                      {t("generation", { n: pet.generation })}
                    </span>
                    {pet.owned ? (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                        {t("owned")}
                      </span>
                    ) : (
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-400">
                        {t("unowned")}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-zinc-500">
                    <span className="rounded bg-orange-50 px-1 py-0.5">⚡{pet.traits.element ?? "?"}</span>
                    <span className="rounded bg-violet-50 px-1 py-0.5">💎{pet.traits.rarity ?? "?"}</span>
                    <span className="rounded bg-sky-50 px-1 py-0.5">❤️{pet.traits.personality ?? "?"}</span>
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
                    setPets((prev) =>
                      prev.map((p) => (p.id === pet.id ? { ...p, customDescription: desc } : p)),
                    );
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
