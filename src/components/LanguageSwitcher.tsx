"use client";

import { useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";

import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * 全局语言切换器（中 / EN）：
 *  - 写入 NEXT_LOCALE Cookie（next-intl 中间件据此持久化语言）；
 *  - 通过 next-intl 的 useRouter 无刷新切换到目标语言同路径；
 *  - 无刷新（客户端路由）切换，刷新后仍保持所选语言。
 */
export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const switchTo = (next: "zh" | "en") => {
    if (next === locale) return;
    document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=31536000; SameSite=Lax`;
    const qs = searchParams.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  const btn = (active: boolean) =>
    `rounded-full px-2 py-0.5 font-medium transition ${
      active ? "bg-orange-500 text-white" : "text-zinc-500 hover:text-orange-600"
    }`;

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-1 py-0.5 text-xs shadow-sm">
      <button type="button" onClick={() => switchTo("zh")} className={btn(locale === "zh")} title="中文">
        中
      </button>
      <span className="text-zinc-300">|</span>
      <button type="button" onClick={() => switchTo("en")} className={btn(locale === "en")} title="English">
        EN
      </button>
    </div>
  );
}
