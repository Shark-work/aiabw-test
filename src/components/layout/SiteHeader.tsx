"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { PointsBalance } from "@/components/PointsBalance";
import { PointsRechargeHost } from "@/components/points-recharge-host";
import { useTheme } from "@/components/theme-provider";

type Me = { username: string; points: number; isCreator: boolean };
type SubStatus = { isVip: boolean; daysRemaining: number } | null;

/**
 * 全局固定顶部导航（2026-09-30 C2 决策：五个主入口 + 「更多」收纳次要入口）：
 *  - 主入口：领养/我的艾比（/pets）、卡包商店（/packs）、背包/融合（/bag）、
 *    灵魂卡/图鉴（/soul-cards）、盲盒广场（/blindbox）；
 *  - 次要入口（首页/我的宠物/道具/图鉴/总量/主页/探索/工坊/商城/手帐/积分/联系）收纳进「更多」；
 *  - 「更多」附「成为创作者」申请入口（2026-10-08 自首页账号条迁入，登录且未成为创作者可见）；
 *  - 移动端折叠为汉堡菜单（主入口 + 更多分组展示，下拉面板 + 遮罩，z-50）；
 *  - 右侧登录态：未登录 → 登录/注册；已登录 → 积分 + 邮箱 + 退出。
 */
export function SiteHeader() {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [sub, setSub] = useState<SubStatus>(null);

  // 每次路由变化后刷新登录态（导航高亮、登录按钮切换）
  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) {
      setMe(null);
      setSub(null);
      return;
    }
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d.user) {
          setMe({ username: d.user.username ?? "", points: d.user.points ?? 0, isCreator: !!d.user.isCreator });
        } else {
          localStorage.removeItem("aiabw_token");
          setMe(null);
          setSub(null);
        }
      })
      .catch(() => setMe(null));

    // VIP 状态：依赖 me 已加载后再渲染（避免未登录态出现按钮闪动）。
    // me 已置为 null 时（即未登录 / 登录态失败），sub 保持 null，导航条隐藏 VIP 入口。
    if (!me) {
      // 上方 me 状态已经更新；下个渲染周期 effect 会再跑一次补全 sub。
    } else {
      fetch("/api/subscription/status", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.ok) {
            setSub({ isVip: !!d.isVip, daysRemaining: Math.max(0, d.daysRemaining ?? 0) });
          } else {
            setSub({ isVip: false, daysRemaining: 0 });
          }
        })
        .catch(() => setSub({ isVip: false, daysRemaining: 0 }));
    }
  }, [pathname, me]);

  const handleLogout = () => {
    localStorage.removeItem("aiabw_token");
    setMe(null);
    window.location.href = `/${locale}`;
  };

  // 充值到账回写（Phase 4）：PointsRechargeHost 全局弹窗扫码入账后实时刷新积分徽章
  const handlePointsChanged = useCallback((p: number) => {
    setMe((prev) => (prev ? { ...prev, points: p } : prev));
  }, []);

  // 创作者申请（2026-10-08 自首页账号条迁入「更多」）：仅登录且未成为创作者时可见
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
        setMe((prev) => (prev ? { ...prev, isCreator: true } : prev));
        alert(t("creatorOk"));
      } else {
        alert(data?.error ?? t("creatorFailed"));
      }
    } catch {
      alert(tc("networkError"));
    }
  };

  // 五个主入口（C2 决策，2026-09-30）
  // P0 概念收敛（2026-10-14）：一级导航收敛为两条资产线 + 核心玩法——
  // 我的灵宠（/pets）→ 收藏中心（/soul-cards）→ 世界藏品（/blindbox）+ 探索；
  // 卡包商店（/packs，停售）与背包/融合（/bag，融合停用）降为「更多」二级入口，
  // 避免用户在一级导航同时看到多套资产体系。
  const mainItems = [
    { href: "/pets", label: t("navAdoptMy") },
    { href: "/soul-cards", label: t("navSoulCodex") },
    { href: "/blindbox", label: t("navBlindbox") },
    { href: "/explore-v2", label: t("navExplore") },
  ];

  // 次要入口：桌面端收纳进「更多」下拉，移动端在汉堡面板分组展示
  const moreItems = [
    { href: "/", label: t("home") },
    { href: "/pets/my", label: t("myPets") }, // 2026-10-09 双页合并：统一入口（/my-pets 308 兼容）
    { href: "/shop", label: t("shop") },
    { href: "/codex", label: t("codex") },
    { href: "/supply", label: t("supply") },
    { href: "/profile", label: t("profile") },
    { href: "/packs", label: t("navPackShop") }, // 概念收敛：卡包停售，页面保留（存量说明）
    { href: "/bag", label: t("navBagFusion") }, // 概念收敛：融合停用，背包查看/互动保留
    { href: "/workshop", label: t("workshop") },
    { href: "/leaderboard", label: t("navLeaderboard") }, // Phase 5：多维排行榜独立页
    { href: "/marketplace", label: t("market") },
    { href: "/handbooks", label: t("journals") },
    { href: "/points", label: t("points") },
    { href: "/contact", label: t("contact") },
  ];

  // usePathname() 来自 i18n/navigation，不含 locale 前缀
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-3 sm:px-4">
        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-2" onClick={() => setOpen(false)}>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-rose-400 text-base shadow-sm">
            🐾
          </span>
          <span className="text-base font-bold tracking-tight text-zinc-900">
            {tc("appName")}
          </span>
        </Link>

        {/* 桌面端主导航：五个主入口 + 「更多」下拉 */}
        <nav className="hidden items-center gap-1 md:flex" aria-label={t("menu")}>
          {mainItems.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                isActive(it.href)
                  ? "bg-orange-100 text-orange-700"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              }`}
            >
              {it.label}
            </Link>
          ))}
          {/* 「更多」下拉：收纳次要入口 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              className="rounded-full px-3 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
            >
              {t("navMore")} ▾
            </button>
            {moreOpen && (
              <>
                <button
                  type="button"
                  aria-label={t("closeMenu")}
                  onClick={() => setMoreOpen(false)}
                  className="fixed inset-0 z-40 cursor-default"
                />
                <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl">
                  {moreItems.map((it) => (
                    <Link
                      key={it.href}
                      href={it.href}
                      onClick={() => setMoreOpen(false)}
                      className={`block rounded-xl px-3 py-2 text-sm font-medium transition ${
                        isActive(it.href)
                          ? "bg-orange-100 text-orange-700"
                          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                      }`}
                    >
                      {it.label}
                    </Link>
                  ))}
                  {/* 成为创作者申请（仅登录且未成为创作者可见） */}
                  {me && !me.isCreator && (
                    <>
                      <div className="my-1 border-t border-zinc-100" />
                      <button
                        type="button"
                        onClick={() => {
                          setMoreOpen(false);
                          void handleApplyCreator();
                        }}
                        className="block w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-violet-600 transition hover:bg-violet-50"
                      >
                        {t("becomeCreator")}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </nav>

        {/* 宠物长期记忆（仅 VIP）：跳转 /memories */}
        {me && sub && sub.isVip ? (
          <Link
            href="/memories"
            className="hidden shrink-0 items-center gap-1 rounded-full bg-violet-100 px-3 py-1 text-sm font-semibold text-violet-700 transition hover:bg-violet-200 hover:shadow-sm md:inline-flex dark:bg-violet-900/30 dark:text-violet-300 dark:hover:bg-violet-900/50"
            title={t("navMemory")}
          >
            <span aria-hidden>🧠</span>
            <span>{t("navMemory")}</span>
          </Link>
        ) : null}

        {/* 桌面端 VIP 入口：仅登录后展示 */}
        {me && sub && (
          sub.isVip ? (
            <Link
              href="/subscribe"
              className="hidden shrink-0 items-center gap-1 rounded-full bg-purple-100 px-3 py-1 text-sm font-semibold text-purple-700 transition hover:bg-purple-200 hover:shadow-sm md:inline-flex dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50"
              title={t("manageSubscription")}
            >
              {t("navVipDays", { days: sub.daysRemaining })}
            </Link>
          ) : (
            <Link
              href="/subscribe"
              className="hidden shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-1 text-sm font-semibold text-white shadow-sm transition hover:scale-105 hover:shadow-md md:inline-flex"
              title={t("navUpgrade")}
            >
              <span aria-hidden>✨</span>
              <span>{t("navUpgrade")}</span>
            </Link>
          )
        )}

        {/* 右侧登录态 */}
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          {me ? (
            <>
              <PointsBalance points={me.points} />
              <span className="max-w-[140px] truncate text-xs text-zinc-500" title={me.username}>
                {me.username}
              </span>
              <Link
                href="/settings"
                aria-label={t("settings")}
                title={t("settings")}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
              >
                ⚙️
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 transition hover:bg-zinc-100"
              >
                {t("logout")}
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-full border border-orange-300 px-4 py-1.5 text-sm font-medium text-orange-600 transition hover:bg-orange-50"
              >
                {t("login")}
              </Link>
              <Link
                href="/register"
                className="rounded-full bg-orange-500 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-orange-600"
              >
                {t("register")}
              </Link>
            </>
          )}
          {/* 主题切换：cute ↔ wild（野性山林） */}
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === "wild" ? "切回可爱主题" : "切换野性山林主题"}
            title={theme === "wild" ? "野性山林" : "切换主题"}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white/70 text-base shadow-sm transition hover:bg-zinc-100"
          >
            {theme === "wild" ? "🌧️" : "🌙"}
          </button>
          {/* 语言切换器：全局导航最右侧、独立单一元素 */}
          <LanguageSwitcher />
        </div>

        {/* 移动端汉堡按钮 */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? t("closeMenu") : t("openMenu")}
          aria-expanded={open}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-xl text-zinc-700 transition hover:bg-zinc-100 md:hidden"
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {/* 移动端汉堡下拉面板 */}
      {open && (
        <>
          {/* 遮罩：点击关闭 */}
          <button
            type="button"
            aria-label={t("closeMenu")}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-zinc-900/40 md:hidden"
          />
          <nav
            className="absolute inset-x-0 top-14 z-50 border-b border-zinc-200 bg-white p-3 shadow-xl md:hidden"
            aria-label={t("menu")}
          >
            <div className="grid grid-cols-2 gap-2">
              {mainItems.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setOpen(false)}
                  className={`rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    isActive(it.href)
                      ? "bg-orange-100 text-orange-700"
                      : "bg-zinc-50 text-zinc-700 hover:bg-orange-50"
                  }`}
                >
                  {it.label}
                </Link>
              ))}
            </div>
            {/* 「更多」分组：次要入口 + VIP 快捷入口 */}
            <p className="mt-3 border-t border-zinc-100 px-1 pt-2 text-xs font-semibold text-zinc-400">
              {t("navMore")}
            </p>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {moreItems.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setOpen(false)}
                  className={`rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    isActive(it.href)
                      ? "bg-orange-100 text-orange-700"
                      : "bg-zinc-50 text-zinc-700 hover:bg-orange-50"
                  }`}
                >
                  {it.label}
                </Link>
              ))}
              {/* 成为创作者申请（仅登录且未成为创作者可见） */}
              {me && !me.isCreator && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void handleApplyCreator();
                  }}
                  className="rounded-xl px-3 py-2.5 text-left text-sm font-medium text-violet-600 transition hover:bg-violet-50"
                >
                  {t("becomeCreator")}
                </button>
              )}
              {/* 宠物长期记忆（仅 VIP） */}
              {me && sub && sub.isVip ? (
                <Link
                  href="/memories"
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center gap-1 rounded-xl bg-violet-100 px-3 py-2.5 text-sm font-semibold text-violet-700"
                  title={t("navMemory")}
                >
                  <span aria-hidden>🧠</span>
                  <span>{t("navMemory")}</span>
                </Link>
              ) : null}
              {/* 移动端 VIP 入口：图标+短文字（仅登录后展示） */}
              {me && sub && (
                sub.isVip ? (
                  <Link
                    href="/subscribe"
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-center gap-1 rounded-xl bg-purple-100 px-3 py-2.5 text-sm font-semibold text-purple-700"
                    title={t("manageSubscription")}
                  >
                    <span aria-hidden>💎</span>
                    <span>{sub.daysRemaining}</span>
                  </Link>
                ) : (
                  <Link
                    href="/subscribe"
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-center gap-1 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-2.5 text-sm font-semibold text-white"
                    title={t("navUpgrade")}
                  >
                    <span aria-hidden>👑</span>
                    <span>VIP</span>
                  </Link>
                )
              )}
            </div>
            <div className="mt-3 flex items-center gap-2 border-t border-zinc-100 pt-3">
              {me ? (
                <>
                  <PointsBalance
                    points={me.points}
                    onClick={() => setOpen(false)}
                    className="flex-1 py-2 text-center"
                  />
                  <Link
                    href="/settings"
                    onClick={() => setOpen(false)}
                    aria-label={t("settings")}
                    title={t("settings")}
                    className="flex items-center justify-center rounded-full border border-zinc-200 px-3 py-2 text-xs text-zinc-600"
                  >
                    ⚙️
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex-1 rounded-full border border-zinc-200 px-3 py-2 text-xs text-zinc-600"
                  >
                    {t("logout")}
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="flex-1 rounded-full border border-orange-300 px-3 py-2 text-center text-sm font-medium text-orange-600"
                  >
                    {t("login")}
                  </Link>
                  <Link
                    href="/register"
                    onClick={() => setOpen(false)}
                    className="flex-1 rounded-full bg-orange-500 px-3 py-2 text-center text-sm font-medium text-white"
                  >
                    {t("register")}
                  </Link>
                </>
              )}
            </div>
            {/* 移动端：主题切换 + 语言切换（独立行，原生名展示） */}
            <div className="mt-3 flex items-center justify-center gap-3 border-t border-zinc-100 pt-3">
              <button
                type="button"
                onClick={toggle}
                aria-label={theme === "wild" ? "切回可爱主题" : "切换野性山林主题"}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white/70 text-base shadow-sm transition hover:bg-zinc-100"
              >
                {theme === "wild" ? "🌧️" : "🌙"}
              </button>
              <LanguageSwitcher />
            </div>
          </nav>
        </>
      )}

      {/* 全局「积分不足」充值引导宿主（Phase 4）：事件总线弹窗，到账回写积分徽章 */}
      {me ? <PointsRechargeHost onPointsChanged={handlePointsChanged} /> : null}
    </header>
  );
}
