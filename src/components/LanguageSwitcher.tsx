"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";

import { usePathname } from "@/i18n/navigation";
import { LOCALE_LABELS, LOCALES } from "@/lib/site";

/**
 * 全局语言切换器（导航栏最右侧，独立单一元素）：
 *  - 触发按钮展示当前语言的原生名称（中文 / English），首字母大写、不用国旗；
 *  - 点击展开下拉菜单，列出全部可用语言；
 *  - 切换时 router.replace 跳转到内容完全等价的同路径页面（绝不回首页）；
 *  - 动态更新 <html lang>（屏幕阅读器 / 无障碍）并写入 NEXT_LOCALE Cookie 持久化；
 *  - 点击外部 / ESC 关闭下拉。
 */
export function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 点击外部或按 ESC 关闭下拉
  useEffect(() => {
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const switchTo = (next: (typeof LOCALES)[number]) => {
    if (next === locale) return;
    setOpen(false);
    // 持久化语言偏好（next-intl 中间件据此重定向）
    document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=31536000; SameSite=Lax`;
    // 无障碍：切换语言后同步 <html lang>，确保屏幕阅读器正确发音
    document.documentElement.lang = next;
    // 显式拼接目标 URL（同路径 + 保留 query）：/zh/pets?species=X → /en/pets?species=X
    const base = pathname === "/" ? "" : pathname;
    const qs = searchParams.toString();
    const target = `/${next}${base}${qs ? `?${qs}` : ""}`;
    // 调试日志：确认目标 URL 拼接正确（dev 环境打印）
    if (process.env.NODE_ENV !== "production") {
      console.log(`[i18n] switch ${locale} → ${next}, target=${target}`);
    }
    // 硬跳转：服务端渲染目标语言页面并全量加载 messages/{next}.json，
    // 确保 server components（Footer/legal 等）与导航全部刷新为对应语言。
    // 注意：next-intl 的 useRouter.replace() 不带 { locale } 参数时只会用当前
    // locale 解析路径（切语言无效），且客户端导航不会重渲染 server 端内容，
    // 故这里使用整页跳转保证正确性与内容完整性。
    window.location.href = target;
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch language / 切换语言"
        className="flex h-9 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-orange-300 hover:text-orange-600"
      >
        <span aria-hidden className="text-base leading-none">
          🌐
        </span>
        <span>{LOCALE_LABELS[locale]}</span>
        <span aria-hidden className={`text-[9px] text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}>
          ▼
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-36 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-xl"
        >
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              role="menuitem"
              onClick={() => switchTo(l)}
              className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition ${
                l === locale ? "bg-orange-50 font-semibold text-orange-600" : "text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <span>{LOCALE_LABELS[l]}</span>
              {l === locale && <span aria-hidden>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

