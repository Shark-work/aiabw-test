import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

/** 全局页脚：辅助导航 + 版权信息 + 自动版本号 + 语言切换。 */
export async function Footer() {
  const t = await getTranslations("footer");
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
  return (
    <footer className="border-t border-zinc-200 bg-white/60 pb-4 pt-5 text-center text-xs text-muted-foreground">
      {/* 页脚辅助导航（关于我们 / 常见问题 / 联系方式 / 用户协议） */}
      <nav
        className="mb-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2"
        aria-label={t("language")}
      >
        <Link href="/about" className="text-zinc-500 transition hover:text-orange-600">
          {t("about")}
        </Link>
        <Link href="/faq" className="text-zinc-500 transition hover:text-orange-600">
          {t("faq")}
        </Link>
        <Link href="/contact" className="text-zinc-500 transition hover:text-orange-600">
          {t("contact")}
        </Link>
        <Link href="/terms" className="text-zinc-500 transition hover:text-orange-600">
          {t("terms")}
        </Link>
      </nav>
      <div className="flex items-center justify-center gap-3">
        <span>{t("copyright", { version })}</span>
        {/* useSearchParams 需要 Suspense 边界，否则 SSR 阶段会抛错 */}
        <Suspense fallback={null}>
          <LanguageSwitcher />
        </Suspense>
      </div>
    </footer>
  );
}
