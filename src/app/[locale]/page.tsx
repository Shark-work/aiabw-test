"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";
import { HomeAibiSection } from "@/components/aibi/home-aibi-section";
import { FortuneBanner, RecentBornMarquee } from "@/components/daily-inspiration";
import { SocialProof } from "@/components/social-proof";
import { BlindboxPlaza } from "@/components/blindbox-plaza";
import { LivingPet } from "@/components/LivingPet";
import { PetDetailModal, type FeaturedPet } from "@/components/pet-detail-modal";
import { UpgradePetModal } from "@/components/upgrade-pet-modal";
import { getRarityMeta } from "@/lib/pet-status";
import { getAnonymousId } from "@/lib/anon-id";

export default function Home() {
  const router = useRouter();
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const ts = useTranslations("seo");
  const locale = useLocale();

  // 正在领养的推荐宠实例 id（详情弹窗按钮 busy 态）
  const [claimingPetId, setClaimingPetId] = useState<string | null>(null);
  // 首页动态推荐宠（替代硬编码 抱抱狐/企鹅/修狗）：
  // 池 = 稀缺（rare/epic/legendary）OR 高领养物种，每次刷新随机 3 只
  const [featured, setFeatured] = useState<FeaturedPet[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [detailPet, setDetailPet] = useState<FeaturedPet | null>(null);
  const [error, setError] = useState("");
  // 单宠限制：用户已有宠物数量 / 是否已解锁 / 可用于支付的宠物 id
  const [petState, setPetState] = useState<{
    petCount: number;
    hasUnlocked: boolean;
    unlockAdoptionId: string | null;
  }>({ petCount: 0, hasUnlocked: false, unlockAdoptionId: null });
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // 用户想领养但被单宠限制拦截的推荐宠；支付解锁后自动完成领养并跳转聊天
  const [pendingPet, setPendingPet] = useState<FeaturedPet | null>(null);

  // 读取当前用户宠物数量 / 解锁状态（单宠限制前端提示）
  const refreshPetState = useCallback(async () => {
    const token = localStorage.getItem("aiabw_token");
    const anonymousId = getAnonymousId();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const res = await fetch(
        `/api/pets${!token && anonymousId ? `?anonymousId=${encodeURIComponent(anonymousId)}` : ""}`,
        { headers },
      );
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
      // 静默失败，不影响页面
    }
  }, []);

  useEffect(() => {
    void refreshPetState();
  }, [refreshPetState]);

  // 拉取动态推荐宠（每次刷新随机 3 只）
  useEffect(() => {
    let alive = true;
    fetch(`/api/pets/featured?count=4&locale=${locale}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.ok && Array.isArray(d.pets)) setFeatured(d.pets);
      })
      .catch(() => {})
      .finally(() => alive && setFeaturedLoading(false));
    return () => {
      alive = false;
    };
  }, [locale]);

  // —— 核心领养：认领用户实际点击的这只推荐宠（图鉴同款 /api/pets/claim 链路）——
  // 成功后带 threadId + adoptionId 跳转聊天页，聊天页按 adoption.petType
  // （species:<id>）解析该物种的头像 / 名字 / 欢迎语，确保展示的就是被领养的那只。
  const claimFeatured = async (pet: FeaturedPet) => {
    setClaimingPetId(pet.id);
    setError("");
    try {
      const token = localStorage.getItem("aiabw_token");
      const anonymousId = getAnonymousId();
      const res = await fetch("/api/pets/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          petId: pet.id,
          ...(!token && anonymousId ? { anonymousId } : {}),
        }),
      });

      const data = await res.json();

      if (data?.ok && data.threadId) {
        // 领养成功 → 带着新线程与领养记录进入独立聊天页面
        // （游客也可先看到这只宠物，发送消息时按提示登录即可）
        void refreshPetState();
        router.push(
          `/chat?thread=${data.threadId}&adopt=${data.adoption?.id ?? ""}`,
        );
      } else if (data?.needPayment === true) {
        // 单宠限制：游客 → 登录（登录后自动迁移本设备已有宠物）；
        // 登录用户 → 0.01 元解锁无限领养，支付成功后自动完成这次领养
        if (!token) {
          router.push("/login?redirect=/my-pets");
          return;
        }
        setPetState((prev) => ({
          ...prev,
          petCount: data.petCount ?? prev.petCount,
          hasUnlocked: false,
          unlockAdoptionId: data.unlockAdoptionId ?? prev.unlockAdoptionId,
        }));
        setPendingPet(pet);
        setUpgradeOpen(true);
      } else {
        throw new Error(data?.error || t("adoptFailed"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("adoptFailed"));
    } finally {
      setClaimingPetId(null);
    }
  };

  // 详情弹窗 CTA「唤醒灵魂」：直接唤醒用户点击的这只推荐宠（闭环）。
  // 单宠限制等拦截统一交给 claimFeatured 处理（游客 → 登录，登录用户 → 支付解锁）。
  const handleGetPet = () => {
    if (!detailPet) return;
    const pet = detailPet;
    setDetailPet(null);
    void claimFeatured(pet);
  };

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden p-4 sm:p-6">
      {/* 艾比世界背景图 */}
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/resources/background_clothing/bg1.webp')" }}
      />
      {/* 半透明白色遮罩，保证内容可读 */}
      <div aria-hidden className="absolute inset-0 bg-white/60" />

      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 pb-10">
        {/* SEO h1（视觉隐藏：Header 已承载品牌标题） */}
        <h1 className="sr-only">{t("title")}</h1>
        {/* 可视 Hero：主标题 + 副标题 + 社交证明（转化优化；一页一 h1 原则，可视主标题用 p） */}
        <div className="text-center">
          <p className="text-2xl font-black tracking-tight text-zinc-900 sm:text-3xl">
            {t("title")}
          </p>
          <p className="mt-2 text-sm text-zinc-500">{t("subtitle")}</p>
          {/* 行动 CTA：副标题下方、社交证明上方，指向 /pets 领养入口
              （项目无 primary 色变量 → 沿用站点主按钮橙色系；t 已绑定 home 命名空间） */}
          <Link
            href="/pets"
            className="mt-4 inline-flex items-center justify-center rounded-full bg-orange-500 px-6 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-orange-600"
          >
            {t("heroCta")}
          </Link>
          <SocialProof className="mt-4 text-xs text-zinc-400" />
        </div>
      {/* 艾比世界（Phase 7 · 8.1）：平台介绍/总供应量/最新铸造/热门稀有/卡包·图鉴·背包入口 */}
      <HomeAibiSection />



        {/* 顶部通告栏：今日运势（Alert Banner，紧凑单行，不抢占头条视觉重心） */}
        <FortuneBanner />

        {/* Middle：盲盒广场（营收引擎，主推放大） */}
        <BlindboxPlaza />

        {/* 实时动态：刚刚诞生的伙伴（横向滚动跑马灯，紧贴盲盒下方营造「很多人正在玩」氛围） */}
        <RecentBornMarquee />

        {/* Bottom：热门宠物展示（Grid 4 列，稀有度角标激发收集欲） */}
        <div className="space-y-3 border-t border-zinc-200/70 pt-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-zinc-900">{t("featuredTitle")}</h2>
              <p className="mt-0.5 text-xs text-zinc-500">{t("featuredSubtitle")}</p>
            </div>
            <Link
              href="/pets"
              className="shrink-0 pb-0.5 text-xs font-medium text-orange-500 transition hover:text-orange-600"
            >
              {ts("viewAll")} →
            </Link>
          </div>
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {featuredLoading ? (
              <p className="col-span-full py-8 text-sm text-zinc-400">{t("featuredLoading")}</p>
            ) : featured.length > 0 ? (
              featured.map((p, i) => {
                const meta = getRarityMeta(String(p.traits.rarity ?? "common"));
                const isRare =
                  p.isRare || ["rare", "epic", "legendary"].includes(String(p.traits.rarity ?? ""));
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setDetailPet(p)}
                    className={`group relative flex flex-col items-center gap-3 rounded-2xl border bg-white/80 p-5 text-center shadow-sm backdrop-blur transition hover:scale-[1.03] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 ${
                      isRare
                        ? "border-amber-200 ring-1 ring-amber-100"
                        : "border-zinc-200 hover:border-orange-300"
                    }`}
                  >
                    {/* 稀有度角标（右上角悬浮，激发收集欲） */}
                    <span
                      className={`absolute -right-2 -top-2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow ${meta.badgeClass}`}
                    >
                      {meta.emoji} {locale === "en" ? meta.labelEn : meta.labelZh}
                    </span>
                    <LivingPet
                      src={p.imageUrl}
                      alt={`${tc("appName")}-${p.speciesName}`}
                      delay={i * 0.35}
                      className="h-20 w-20 rounded-full border-4 border-orange-200 bg-orange-50 object-cover shadow-lg"
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="truncate text-sm font-semibold text-zinc-900">{p.speciesName}</div>
                      <div className="flex items-center justify-center gap-1.5">
                        {p.isRare && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            {t("detailRare")}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="rounded-full bg-orange-500 px-5 py-2 text-sm font-semibold text-white shadow transition group-hover:bg-orange-600">
                      {t("get")}
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="col-span-full py-8 text-sm text-zinc-400">{t("featuredEmpty")}</p>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <p className="text-xs text-zinc-400">{t("adoptHint")}</p>
      </div>

      {/* 动态推荐宠详情半屏弹窗（转化 CTA） */}
      {detailPet && (
        <PetDetailModal
          pet={detailPet}
          busy={claimingPetId !== null}
          onAdopt={handleGetPet}
          onClose={() => setDetailPet(null)}
        />
      )}

      <UpgradePetModal
        open={upgradeOpen}
        adoptionId={petState.unlockAdoptionId}
        petCount={petState.petCount}
        onClose={() => setUpgradeOpen(false)}
        onUnlocked={() => {
          // 支付成功：刷新解锁状态 + 自动完成被拦截的领养并跳转聊天页
          const pending = pendingPet;
          setPendingPet(null);
          setError("");
          void refreshPetState();
          if (pending) {
            void claimFeatured(pending);
          }
        }}
      />
    </main>
  );
}
