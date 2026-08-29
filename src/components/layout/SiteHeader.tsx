"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTheme } from "@/components/theme-provider";

type Me = { email: string; points: number };

/**
 * 全局固定顶部导航：
 *  - 桌面端横向展示 6 个核心入口（首页 / 动物全图鉴 / 我的宠物 / 商城 / 手帐 / 积分）；
 *  - 移动端折叠为汉堡菜单（下拉面板 + 遮罩，z-50，不遮挡核心内容）；
 *  - 右侧登录态：未登录 → 登录/注册；已登录 → 积分 + 邮箱 + 退出。
 */
export function SiteHeader() {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  // 每次路由变化后刷新登录态（导航高亮、登录按钮切换）
  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) {
      setMe(null);
      return;
    }
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d.user) {
          setMe({ email: d.user.email ?? "", points: d.user.points ?? 0 });
        } else {
          localStorage.removeItem("aiabw_token");
          setMe(null);
        }
      })
      .catch(() => setMe(null));
  }, [pathname]);

  const handleLogout = () => {
    localStorage.removeItem("aiabw_token");
    setMe(null);
    window.location.href = `/${locale}`;
  };

  const items = [
    { href: "/", label: t("home") },
    { href: "/pets", label: t("catalog") },
    { href: "/my-pets", label: t("myPets") },
    { href: "/marketplace", label: t("market") },
    { href: "/handbooks", label: t("journals") },
    { href: "/points", label: t("points") },
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

        {/* 桌面端主导航 */}
        <nav className="hidden items-center gap-1 md:flex" aria-label={t("menu")}>
          {items.map((it) => (
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
        </nav>

        {/* 右侧登录态 */}
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          {me ? (
            <>
              <Link
                href="/points"
                className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-200"
              >
                ⭐ {me.points}
              </Link>
              <span className="max-w-[140px] truncate text-xs text-zinc-500" title={me.email}>
                {me.email}
              </span>
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
              {items.map((it) => (
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
            <div className="mt-3 flex items-center gap-2 border-t border-zinc-100 pt-3">
              {me ? (
                <>
                  <Link
                    href="/points"
                    onClick={() => setOpen(false)}
                    className="flex-1 rounded-full bg-amber-100 px-3 py-2 text-center text-xs font-semibold text-amber-700"
                  >
                    ⭐ {me.points}
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
    </header>
  );
}
