import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { MailIcon, QQIcon, XIcon } from "@/components/social-icons";
import { VisitCounter } from "@/components/visit-counter";
import { FooterCollapsible } from "@/components/layout/FooterCollapsible";
import { CONTACT_INFO, EMAIL_URL } from "@/lib/config";

/** 全局页脚：默认折叠仅显示主版权行（+展开按钮）；展开后显示辅助导航 / 联系方式 / 法律条款 / 访问计数。 */
export async function Footer() {
  const t = await getTranslations("footer");
  const ts = await getTranslations("support");
  return (
    <footer className="border-t border-zinc-200 bg-white/60 pb-4 pt-5 text-center text-xs text-muted-foreground">
      <FooterCollapsible
        copyrightLine={t("copyrightLine")}
        expandLabel={t("expand")}
        collapseLabel={t("collapse")}
      >
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
      {/* 全站统一客服渠道（QQ群 / X / 邮箱，来源 src/lib/config.ts CONTACT_INFO） */}
      <address className="mb-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 px-4 text-xs not-italic text-zinc-500">
        {/* QQ 群：一键加群（跳转腾讯官方加群页，群号保留展示） */}
        <a
          href={CONTACT_INFO.qqGroupJoinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-zinc-600 transition hover:text-zinc-900"
          title={ts("socialQqGroupHint")}
        >
          <QQIcon className="h-4 w-4 text-[#12B7F5]" />
          {ts("socialQqGroup")}
        </a>
        <span aria-hidden className="text-zinc-200">
          |
        </span>
        <a
          href={CONTACT_INFO.xUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-zinc-600 transition hover:text-zinc-900"
        >
          <XIcon className="h-4 w-4" />
          {ts("socialX")}
        </a>
        <span aria-hidden className="text-zinc-200">
          |
        </span>
        <a
          href={EMAIL_URL}
          className="flex items-center gap-1.5 text-zinc-600 transition hover:text-zinc-900"
        >
          <MailIcon className="h-4 w-4" />
          {ts("socialEmail")}
        </a>
      </address>

      {/* 法律条款（原创声明 + 虚拟社区声明，缩小浅灰弱化；主版权行始终显示，见 FooterCollapsible） */}
      <div className="mx-auto max-w-3xl space-y-1.5 border-t border-zinc-100 px-6 pb-2 pt-3">
        <p className="text-[11px] leading-snug text-slate-500">{t("originalNotice")}</p>
        <p className="text-[11px] leading-snug text-slate-500">{t("disclaimer")}</p>
      </div>
      {/* 访问计数（人气感）：客户端加载，失败静默 */}
      <VisitCounter />
      </FooterCollapsible>
    </footer>
  );
}
