"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { PetAvatar } from "@/components/PetAvatar";
import { UpgradePetModal } from "@/components/upgrade-pet-modal";
import { PetKnowledgeModal, type KnowledgePet } from "@/components/pet-knowledge-modal";
import { LeaderboardPanel } from "@/components/leaderboard-panel";
import { getRarityMeta } from "@/lib/pet-status";
import { SITE_URL } from "@/lib/site";

type CatalogPet = {
  id: string;
  speciesId: string;
  speciesName: string;
  category: string;
  habitat?: string | null;
  imageUrl: string;
  traits: { element?: string; rarity?: string; personality?: string; [k: string]: unknown };
  defaultDescription: string;
  /** 是否已被领养（owner_id 非空） */
  owned?: boolean;
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
  // 图鉴 / 排行榜 Tab
  const [tab, setTab] = useState<"catalog" | "leaderboard">("catalog");
  // —— 核心领养（图鉴交互）——
  const [petState, setPetState] = useState<{
    petCount: number;
    hasUnlocked: boolean;
    unlockAdoptionId: string | null;
  }>({ petCount: 0, hasUnlocked: false, unlockAdoptionId: null });
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [celebratePet, setCelebratePet] = useState<CatalogPet | null>(null);
  const [knowledgePet, setKnowledgePet] = useState<KnowledgePet | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [pendingPetId, setPendingPetId] = useState<string | null>(null);

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

  // —— 当前用户宠物数量 / 解锁状态（单宠限制提示）——
  const refreshPetState = useCallback(async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    try {
      const res = await fetch("/api/pets", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.ok && Array.isArray(data.pets)) {
        const pets = data.pets as { id: string; isUnlocked: boolean }[];
        setPetState({
          petCount: pets.length,
          hasUnlocked: pets.some((p) => p.isUnlocked),
          unlockAdoptionId: pets[0]?.id ?? null,
        });
      }
    } catch {
      // 静默失败，不影响浏览
    }
  }, []);

  useEffect(() => {
    void refreshPetState();
  }, [refreshPetState]);

  // 领养成功祝贺动画：约 1.8s 后自动消失（知识弹窗由 handleClaim 同步打开）
  useEffect(() => {
    if (!celebratePet) return;
    const timer = setTimeout(() => setCelebratePet(null), 1800);
    return () => clearTimeout(timer);
  }, [celebratePet]);

  // —— 核心领养流程：游客引导 / 免费领养 / 402 支付解锁 ——
  const handleClaim = async (pet: CatalogPet) => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) {
      setShowLogin(true);
      return;
    }
    setClaimingId(pet.id);
    setError("");
    try {
      const res = await fetch("/api/pets/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ petId: pet.id }),
      });
      const data = await res.json();
      if (data?.ok) {
        // 领养成功 → 祝贺动画 + 知识百科弹窗（含专属对话入口）
        setCelebratePet(pet);
        setKnowledgePet({
          id: pet.id,
          speciesId: pet.speciesId,
          speciesName: pet.speciesName,
          category: pet.category,
          habitat: pet.habitat,
          imageUrl: pet.imageUrl,
          traits: pet.traits,
          defaultDescription: pet.defaultDescription,
          threadId: data.threadId,
          adoptionId: data.adoption?.id ?? null,
        });
        void refreshPetState();
        void load();
      } else if (data?.needPayment) {
        // 单宠限制：引导 0.01 元支付解锁无限领养
        setPetState((prev) => ({
          ...prev,
          petCount: data.petCount ?? prev.petCount,
          hasUnlocked: false,
          unlockAdoptionId: data.unlockAdoptionId ?? prev.unlockAdoptionId,
        }));
        setPendingPetId(pet.id);
        setUpgradeOpen(true);
      } else {
        setError(data?.error ?? t("claimFailed"));
      }
    } catch {
      setError(t("claimFailed"));
    } finally {
      setClaimingId(null);
    }
  };

  // 支付成功后：刷新解锁状态 + 自动完成被拦截的领养
  const handleUpgradeUnlocked = () => {
    const pending = pendingPetId;
    setPendingPetId(null);
    void refreshPetState();
    if (pending) {
      const p = pets.find((x) => x.id === pending);
      if (p) void handleClaim(p);
    }
  };

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

        {/* 图鉴 / 排行榜 Tab */}
        <div className="mb-3 flex gap-2">
          <button type="button" onClick={() => setTab("catalog")} className={chip(tab === "catalog")}>
            {t("tabCatalog")}
          </button>
          <button type="button" onClick={() => setTab("leaderboard")} className={chip(tab === "leaderboard")}>
            {t("tabLeaderboard")}
          </button>
        </div>

        {tab === "catalog" ? (
          <>
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

                {/* SEO 详情页内链（独立落地页） */}
                <Link
                  href={`/pets/${pet.speciesId}`}
                  className="mt-2 inline-block text-[11px] font-medium text-orange-500 transition hover:text-orange-600"
                >
                  {t("detail")} →
                </Link>

                {/* 核心领养 CTA */}
                <button
                  type="button"
                  disabled={!!pet.owned || claimingId === pet.id}
                  onClick={() => void handleClaim(pet)}
                  className={`mt-3 w-full rounded-full px-4 py-2 text-sm font-semibold transition ${
                    pet.owned
                      ? "cursor-not-allowed bg-zinc-100 text-zinc-400"
                      : "bg-orange-500 text-white shadow hover:bg-orange-600 disabled:opacity-60"
                  }`}
                >
                  {pet.owned
                    ? t("claimed")
                    : claimingId === pet.id
                      ? t("claiming")
                      : t("get")}
                </button>
                {!pet.owned && (
                  <p className="mt-1 text-center text-[10px] text-zinc-400">{t("getHint")}</p>
                )}
              </div>
            );
          })}
        </div>
          </>
        ) : (
          <LeaderboardPanel />
        )}
      </div>

      {/* 领养成功祝贺动画 */}
      {celebratePet && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm">
          <div className="animate-bounce rounded-3xl border border-orange-200 bg-white px-8 py-6 text-center shadow-2xl">
            <div className="text-4xl">🎉</div>
            <div className="mt-2 text-lg font-bold text-orange-600">{t("claimSuccess")}</div>
            <div className="mt-1 text-sm text-zinc-600">
              {t("celebrate", { name: celebratePet.speciesName })}
            </div>
          </div>
        </div>
      )}

      {/* 游客登录引导弹窗 */}
      {showLogin && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/60 p-4 backdrop-blur-sm"
          onClick={() => setShowLogin(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-zinc-900">🔑 {t("needLogin")}</h3>
            <p className="mt-1 text-sm text-zinc-500">{t("needLoginHint")}</p>
            <div className="mt-4 flex gap-2">
              <Link
                href="/login"
                className="flex-1 rounded-full bg-orange-500 px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-orange-600"
              >
                {t("loginNow")}
              </Link>
              <Link
                href="/register"
                className="flex-1 rounded-full bg-zinc-100 px-4 py-2 text-center text-sm text-zinc-600 transition hover:bg-zinc-200"
              >
                {t("registerNow")}
              </Link>
            </div>
            <button
              type="button"
              onClick={() => setShowLogin(false)}
              className="mt-3 w-full text-center text-xs text-zinc-400 hover:text-zinc-600"
            >
              {t("knowledgeLater")}
            </button>
          </div>
        </div>
      )}

      {/* 宠物知识百科弹窗（领养成功后弹出） */}
      {knowledgePet && (
        <PetKnowledgeModal
          pet={knowledgePet}
          onClose={() => setKnowledgePet(null)}
          onGoChat={(threadId, adoptionId) => {
            setKnowledgePet(null);
            window.location.href = `/${locale}/chat?thread=${threadId}&adopt=${adoptionId}`;
          }}
        />
      )}

      {/* 0.01 元支付解锁无限领养（单宠限制触发） */}
      <UpgradePetModal
        open={upgradeOpen}
        adoptionId={petState.unlockAdoptionId}
        petCount={petState.petCount}
        onClose={() => setUpgradeOpen(false)}
        onUnlocked={handleUpgradeUnlocked}
      />
    </main>
  );
}
