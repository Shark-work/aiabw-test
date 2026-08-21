import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

/** 全局页脚：辅助导航 + 版权信息 + 自动版本号 + 语言切换。 */
export async function Footer() {
  const t = await getTranslations("footer");
  const ts = await getTranslations("support");
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
  return (
    <footer className="border-t border-zinc-200 bg-white/60 pb-4 pt-5 text-center text-xs text-muted-foreground">
      {/* 页脚辅助导航（关于 / FAQ / 联系 + 法律合规三件套） */}
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
        <span className="text-zinc-200" aria-hidden>
          |
        </span>
        <Link href="/legal/terms" className="text-zinc-500 transition hover:text-orange-600">
          {t("terms")}
        </Link>
        <Link href="/legal/privacy" className="text-zinc-500 transition hover:text-orange-600">
          {t("privacy")}
        </Link>
        <Link href="/legal/virtual-goods" className="text-zinc-500 transition hover:text-orange-600">
          {t("virtualGoods")}
        </Link>
      </nav>
      {/* 客服联系方式（HTML5 <address> 语义化，便于屏幕阅读器与 SEO 识别） */}
      <address className="mb-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 px-4 text-xs not-italic text-zinc-500">
        <span>
          {ts("supportEmail")}：
          <a href="mailto:1206309834@qq.com" className="text-zinc-600 transition hover:text-orange-600">
            1206309834@qq.com
          </a>
        </span>
        <span aria-hidden className="text-zinc-200">
          |
        </span>
        <span>
          {ts("supportQQGroup")}：
          <span className="font-mono text-zinc-600">1005445619</span>
        </span>
      </address>

      {/* 版权声明与免责条款（上线前合规） */}
      <div className="mx-auto mb-3 max-w-3xl space-y-1.5 border-t border-zinc-100 px-6 pt-4">
        <p className="font-semibold text-zinc-600">{t("copyrightLine")}</p>
        <p className="leading-relaxed text-zinc-500">{t("originalNotice")}</p>
        <p className="leading-relaxed text-zinc-500">{t("disclaimer")}</p>
      </div>

      <div className="flex items-center justify-center">
        <span>{t("copyright", { version })}</span>
      </div>
    </footer>
  );
}
