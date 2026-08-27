"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";
import { DailyInspiration } from "@/components/daily-inspiration";
import { NewsCarousel } from "@/components/news-carousel";
import { SidebarAnimalNews } from "@/components/sidebar-animal-news";
import { BlindboxPlaza } from "@/components/blindbox-plaza";
import { PetAvatar } from "@/components/PetAvatar";
import { PetDetailModal, type FeaturedPet } from "@/components/pet-detail-modal";
import { UpgradePetModal } from "@/components/upgrade-pet-modal";
import { getRarityMeta } from "@/lib/pet-status";
import { type PetType, DEFAULT_PET_TYPE } from "@/lib/pet-config";
import { getAnonymousId } from "@/lib/anon-id";

export default function Home() {
  const router = useRouter();
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const locale = useLocale();

  const [adoptingType, setAdoptingType] = useState<PetType | null>(null);
  // 首页动态推荐宠（替代硬编码 抱抱狐/企鹅/修狗）：
  // 池 = 稀缺（rare/epic/legendary）OR 高领养物种，每次刷新随机 3 只
  const [featured, setFeatured] = useState<FeaturedPet[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [detailPet, setDetailPet] = useState<FeaturedPet | null>(null);
  const [error, setError] = useState("");
  const [user, setUser] = useState<{
    id: string;
    email: string;
    points: number;
    isCreator: boolean;
  } | null>(null);
  // 单宠限制：用户已有宠物数量 / 是否已解锁 / 可用于支付的宠物 id
  const [petState, setPetState] = useState<{
    petCount: number;
    hasUnlocked: boolean;
    unlockAdoptionId: string | null;
  }>({ petCount: 0, hasUnlocked: false, unlockAdoptionId: null });
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // 用户想领养但被单宠限制拦截的类型；支付解锁后自动完成领养并跳转聊天
  const [pendingAdoptType, setPendingAdoptType] = useState<PetType | null>(null);
  const petLimitReached = petState.petCount >= 1 && !petState.hasUnlocked;

  // 从 localStorage 恢复登录态
  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.ok && data.user) {
          setUser({
            id: data.user.id,
            email: data.user.email,
            points: data.user.points ?? 0,
            isCreator: !!data.user.isCreator,
          });
        } else {
          localStorage.removeItem("aiabw_token");
        }
      })
      .catch(() => {});
  }, []);

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
    fetch("/api/pets/featured?count=3")
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
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("aiabw_token");
    setUser(null);
  };

  const handleCheckin = async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    try {
      const res = await fetch("/api/user/checkin", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.ok) {
        setUser((prev) => (prev ? { ...prev, points: data.points ?? prev.points } : prev));
        alert(data.already ? t("checkinAlready") : t("checkinOk"));
      } else {
        alert(data?.error ?? t("checkinFailed"));
      }
    } catch {
      alert(tc("networkError"));
    }
  };

  const handleApplyCreator = async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    try {
      const res = await fetch("/api/creator/apply", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.ok) {
        setUser((prev) => (prev ? { ...prev, isCreator: true } : prev));
        alert(t("creatorOk"));
      } else {
        alert(data?.error ?? t("creatorFailed"));
      }
    } catch {
      alert(tc("networkError"));
    }
  };

  const handleAdopt = async (petType: PetType) => {
    if (adoptingType) return;
    setAdoptingType(petType);
    setError("");

    try {
      const token = localStorage.getItem("aiabw_token");
      const anonymousId = getAnonymousId();
      const res = await fetch("/api/adopt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          petType,
          ...(anonymousId ? { anonymousId } : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // 单宠限制：引导用户解锁付费
        if (data?.needPayment === true) {
          setError(data.error || t("unlockFirst"));
          if (data.unlockAdoptionId) {
            setPetState((prev) => ({
              ...prev,
              petCount: data.petCount ?? prev.petCount,
              hasUnlocked: false,
              unlockAdoptionId: data.unlockAdoptionId,
            }));
          }
          // 恢复卡片可点 + 记住解锁后要领养的宠物类型（支付成功 → 自动领养）
          setAdoptingType(null);
          setPendingAdoptType(petType);
          setUpgradeOpen(true);
          return;
        }
        throw new Error(data.error || t("adoptFailed"));
      }

      // 领养成功 → 带着新线程与领养记录进入独立聊天页面
      if (data.ok && data.threadId) {
        router.push(
          `/chat?thread=${data.threadId}&adopt=${data.adoption?.id ?? ""}`,
        );
      } else {
        router.push("/chat");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("adoptFailed"));
      setAdoptingType(null);
    }
  };

  // 详情弹窗 CTA「获得它」：单宠限制 → 支付解锁；可领养 → 直接领养默认伙伴（闭环）
  const handleGetPet = () => {
    if (!detailPet) return;
    setDetailPet(null);
    if (petLimitReached) {
      setUpgradeOpen(true);
      return;
    }
    void handleAdopt(DEFAULT_PET_TYPE);
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

      {/* 账号入口 */}
      <div className="relative z-20 flex justify-end px-2 pt-2">
        {user ? (
          <div className="flex flex-wrap items-center justify-end gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-1.5 text-sm shadow-sm backdrop-blur">
            <span className="font-medium text-violet-600">
              <Link href="/points" className="hover:underline" title={tc("points")}>
                {tc("points")} {user.points}
              </Link>
            </span>
            <button
              type="button"
              onClick={handleCheckin}
              className="font-medium text-emerald-600 hover:underline"
            >
              {t("checkin")}
            </button>
            {!user.isCreator && (
              <button
                type="button"
                onClick={handleApplyCreator}
                className="font-medium text-violet-600 hover:underline"
              >
                {t("becomeCreator")}
              </button>
            )}
            <Link href="/marketplace" className="font-medium text-zinc-600 hover:text-orange-600">
              🛍️ {tc("market")}
            </Link>
            <Link href="/handbooks" className="font-medium text-zinc-600 hover:text-orange-600">
              📔 {tc("journals")}
            </Link>
            <Link href="/my-pets" className="font-medium text-zinc-600 hover:text-orange-600">
              🐾 {tc("myPets")}
            </Link>
            <span className="text-zinc-300">|</span>
            <span className="text-zinc-600">{user.email}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="font-medium text-orange-600 hover:underline"
            >
              {tc("logout")}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-full border border-zinc-200 bg-white/80 px-4 py-1.5 text-sm shadow-sm backdrop-blur">
            <Link href="/marketplace" className="font-medium text-zinc-600 hover:text-orange-600">
              🛍️ {tc("market")}
            </Link>
            <span className="text-zinc-300">|</span>
            <Link href="/login" className="font-medium text-zinc-600 hover:text-orange-600">
              {tc("signIn")}
            </Link>
            <span className="text-zinc-300">|</span>
            <Link href="/register" className="font-medium text-orange-600 hover:underline">
              {tc("register")}
            </Link>
          </div>
        )}
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
            {t("title")}
          </h1>
          <p className="text-sm text-zinc-600">{t("subtitle")}</p>
        </div>

        {/* 稀缺性：首屏稀有宠物入口（→ 动物全图鉴） */}
        <Link
          href="/pets"
          className="block w-full rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-500 to-orange-400 p-4 text-left shadow-lg transition hover:scale-[1.01] hover:shadow-xl"
        >
          <p className="text-sm font-bold text-white">{t("rareBannerTitle")}</p>
          <p className="mt-0.5 text-xs text-white/85">{t("rareBannerSub")}</p>
        </Link>

        {/* 宠物选择卡片 */}
        {/* 今日运势（悬浮叠加：z-20 + 负下边距，覆盖在推荐卡上方增加视觉层次） */}
        <div className="relative z-20 w-full -mb-8">
          <DailyInspiration />
        </div>

        {/* 🐾 动物世界头条（今日运势下方）：Top5 轮播，5s 自动切换 + 悬停暂停 */}
        <div className="relative z-10 w-full">
          <NewsCarousel />
        </div>

        {/* 🔥 动物新闻热榜（移动端折叠版：PC 走全局侧边栏，<lg 展示在首页信息流） */}
        <div className="relative z-10 mt-4 w-full lg:hidden">
          <SidebarAnimalNews />
        </div>

        {/* 动态推荐宠（替代硬编码：稀缺 OR 高领养物种，每次刷新随机 3 只） */}
        <div className="relative z-10 grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
          {featuredLoading ? (
            <p className="col-span-full py-8 text-sm text-zinc-400">{t("featuredLoading")}</p>
          ) : featured.length > 0 ? (
            featured.map((p) => {
              const meta = getRarityMeta(String(p.traits.rarity ?? "common"));
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setDetailPet(p)}
                  className="group flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white/80 p-5 text-center shadow-sm backdrop-blur transition hover:scale-[1.03] hover:border-orange-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2"
                >
                  <PetAvatar
                    src={p.imageUrl}
                    alt={`${tc("appName")}-${p.speciesName}`}
                    className="h-24 w-24 rounded-full border-4 border-orange-200 bg-orange-50 object-cover shadow-lg transition group-hover:scale-105"
                  />
                  <div className="space-y-1">
                    <div className="text-lg font-semibold text-zinc-900">{p.speciesName}</div>
                    <div className="flex items-center justify-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}>{meta.emoji} {locale === "en" ? meta.labelEn : meta.labelZh}</span>
                      {p.isRare && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{t("detailRare")}</span>}
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

        {/* 盲盒广场（营收引擎：积分/支付抽奖 + 爆率公示） */}
        <div className="relative z-10 mt-6 w-full">
          <BlindboxPlaza />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <p className="text-xs text-zinc-400">{t("adoptHint")}</p>

        {/* 艾比每日灵感：今日幸运宠 + 最新诞生（替代旧版 AI 工具诊断） */}
      </div>

      {/* 动态推荐宠详情半屏弹窗（转化 CTA） */}
      {detailPet && (
        <PetDetailModal
          pet={detailPet}
          busy={adoptingType !== null}
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
          const pending = pendingAdoptType;
          setPendingAdoptType(null);
          setError("");
          void refreshPetState();
          if (pending) {
            void handleAdopt(pending);
          }
        }}
      />
    </main>
  );
}
