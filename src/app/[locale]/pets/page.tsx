"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { PetAvatar } from "@/components/PetAvatar";
import { getRarityMeta } from "@/lib/pet-status";
import { SITE_URL } from "@/lib/site";

type CatalogPet = {
  id: string;
  speciesId: string;
  speciesName: string;
  category: string;
  imageUrl: string;
  traits: { element?: string; rarity?: string; personality?: string; [k: string]: unknown };
  defaultDescription: string;
};

const ELEMENTS = ["fire", "water", "earth", "air"];
const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];

/** 图鉴收录的精选物种（GEO：JSON-LD ItemList 静态条目，SSR 可靠输出）。 */
const LD_SPECIES = [
  { id: "golden_retriever", zh: "金毛", en: "Golden Retriever" },
  { id: "maine_coon", zh: "缅因猫", en: "Maine Coon" },
  { id: "penguin", zh: "企鹅", en: "Penguin" },
  { id: "parrot", zh: "鹦鹉", en: "Parrot" },
  { id: "sea_otter", zh: "海獭", en: "Sea Otter" },
  { id: "hedgehog", zh: "刺猬", en: "Hedgehog" },
  { id: "corgi", zh: "柯基", en: "Corgi" },
  { id: "red_panda", zh: "小熊猫", en: "Red Panda" },
  { id: "tortoise", zh: "陆龟", en: "Tortoise" },
  { id: "owl", zh: "猫头鹰", en: "Owl" },
];

/**
 * 动物图鉴（公共物种百科）：
 *  - 只读展示全部预计算宠物的物种、属性与介绍；
 *  - 保留分类导航 + 元素 / 稀有度筛选（GIN 索引）；
 *  - 合成 / 进化 / 我的宠物 等操作在 /pets/my（我的宠物合成页）。
 */
export default function PetsCatalogPage() {
  const t = useTranslations("petsCatalog");
  const locale = useLocale();
  const [pets, setPets] = useState<CatalogPet[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [element, setElement] = useState("");
  const [rarity, setRarity] = useState("");
  // 今日幸运宠等外部入口可通过 ?species=xxx 直达该物种
  const [species, setSpecies] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ limit: "60" });
      if (category) qs.set("category", category);
      if (element) qs.set("element", element);
      if (rarity) qs.set("rarity", rarity);
      if (species) qs.set("species", species);
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
  }, [category, element, rarity, species, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // 外部入口（今日幸运宠等）通过 URL 参数直达物种/稀有度
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const s = qs.get("species");
    const r = qs.get("rarity");
    if (s) setSpecies(s);
    if (r) setRarity(r);
  }, []);

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs transition ${
      active ? "bg-orange-500 text-white" : "bg-white text-zinc-600 border border-zinc-200 hover:border-orange-300"
    }`;

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 sm:p-6">
      {/* GEO 结构化数据：图鉴 ItemList（物种条目）+ BreadcrumbList */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: locale === "en" ? "AIABW Pet Encyclopedia" : "艾比世界动物图鉴",
            description: t("subtitle"),
            url: `${SITE_URL}/${locale}/pets`,
            itemListElement: LD_SPECIES.map((s, i) => ({
              "@type": "ListItem",
              position: i + 1,
              item: {
                "@type": "Product",
                name: locale === "en" ? s.en : s.zh,
                description:
                  locale === "en"
                    ? `${s.en} virtual pet in AIABW - adopt, chat and fuse to level up.`
                    : `${s.zh}——艾比世界虚拟宠物，可领养互动，3 合 1 灵力融合升级。`,
                category: "Virtual Pet / 虚拟宠物",
                url: `${SITE_URL}/${locale}/pets?species=${s.id}`,
              },
            })),
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: locale === "en" ? "Home" : "首页", item: `${SITE_URL}/${locale}` },
              {
                "@type": "ListItem",
                position: 2,
                name: locale === "en" ? "Pet Encyclopedia" : "动物图鉴",
                item: `${SITE_URL}/${locale}/pets`,
              },
            ],
          }),
        }}
      />
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>

            <h1 className="text-xl font-semibold text-zinc-900">{t("title")}</h1>
            <p className="text-xs text-zinc-500">{t("subtitle")}</p>
          </div>
        </div>

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

        {/* 元素筛选（GIN 索引） */}
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
            return (
              <div
                key={pet.id}
                className="relative rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm backdrop-blur"
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
                    <div className="mt-0.5 font-mono text-[10px] text-zinc-300">{pet.id}</div>
                  </div>
                </div>

                {/* 物种介绍（百科） */}
                <p className="mt-3 border-t border-zinc-100 pt-2 text-xs leading-relaxed text-zinc-600">
                  {pet.defaultDescription}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
