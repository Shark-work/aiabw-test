"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const MENU = [
  { href: "/admin/dashboard", label: "馃搳 鏁版嵁鐪嬫澘" },
  { href: "/admin/pets", label: "馃惥 瀹犵墿绠＄悊" },
  { href: "/admin/users", label: "馃懃 鐢ㄦ埛绠＄悊" },
  { href: "/admin/news", label: "馃摪 鍐呭/鏂伴椈" },
  { href: "/admin/economy", label: "馃挵 绉垎/鍟嗗煄" },
  { href: "/admin/settings", label: "鈿欙笍 绯荤粺璁剧疆" },
];

/**
 * 绔欓暱鍚庡彴澶栧３锛圓dminGuard + 宸︿晶杈规爮甯冨眬锛夛細
 *  - 璁块棶 /admin/* 蹇呴』鐧诲綍涓?role === 'admin'锛屽惁鍒欓噸瀹氬悜鍒扮櫥褰曢〉锛? *  - 宸︿晶杈规爮 + 鍙充晶鍐呭鍖猴紝鏋佺畝楂樹俊鎭瘑搴︺€? */
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
        鏍￠獙绠＄悊鍛樿韩浠解€?      </div>
    );
  }
  if (!authed) return null;

  return (
    <div className="flex min-h-screen bg-zinc-100 text-zinc-800">
      {/* 宸︿晶杈规爮 */}
      <aside className="sticky top-0 h-screen w-52 shrink-0 border-r border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-4 py-4 text-sm font-bold text-zinc-900">
          馃洜锔?绔欓暱鍚庡彴
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

      {/* 鍙充晶鍐呭鍖?*/}
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
