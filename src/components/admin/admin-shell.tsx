"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const MENU = [
  { href: "/admin/dashboard", label: "📊 数据看板" },
  { href: "/admin/pets", label: "🐾 宠物管理" },
  { href: "/admin/users", label: "👥 用户管理" },
  { href: "/admin/news", label: "📰 内容/新闻" },
  { href: "/admin/moderation", label: "🛡️ 内容审核" },
  { href: "/admin/economy", label: "💰 积分/商城" },
  { href: "/admin/settings", label: "⚙️ 系统设置" },
];

/**
 * 站长后台外壳（AdminGuard + 左侧边栏布局）：
 *  - 访问 /admin/* 必须登录且 role === 'admin'，否则重定向到登录页；
 *  - 左侧边栏 + 右侧内容区，极简高信息密度。
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    const toLogin = (reauth = false) => {
      window.location.href = `/login?redirect=${encodeURIComponent(pathname)}${reauth ? "&reauth=true" : ""}`;
    };
    if (!token) {
      toLogin();
      return;
    }
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const d = await r.json();
        if (r.status === 401) {
          // 会话过期（JWT 失效 / 超过 24h 未登录）：要求重新登录
          toLogin(true);
          return;
        }
        if (d?.ok && d.user?.role === "admin") {
          setAuthed(true);
        } else {
          toLogin();
        }
      })
      .catch(() => toLogin());
  }, [pathname]);

  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 text-sm text-zinc-400">
        校验管理员身份…
      </div>
    );
  }
  if (!authed) return null;

  return (
    <div className="flex min-h-screen bg-zinc-100 text-zinc-800">
      {/* 左侧边栏 */}
      <aside className="sticky top-0 h-screen w-52 shrink-0 border-r border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-4 py-4 text-sm font-bold text-zinc-900">
          🛡️ 站长后台
          <span className="ml-1 text-[10px] font-normal text-zinc-400">AIABW Admin</span>
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {MENU.map((m) => {
            const active = pathname === m.href || (m.href !== "/admin/dashboard" && pathname.startsWith(m.href));
            return (
              <a
                key={m.href}
                href={m.href}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  active ? "bg-orange-100 text-orange-700" : "text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                {m.label}
              </a>
            );
          })}
        </nav>
        <div className="absolute bottom-4 left-0 right-0 px-4">
          <Link
            href="/"
            className="block rounded-lg border border-zinc-200 px-3 py-2 text-center text-xs text-zinc-500 hover:bg-zinc-50"
          >
            ← 返回前台
          </Link>
        </div>
      </aside>

      {/* 右侧内容区 */}
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
