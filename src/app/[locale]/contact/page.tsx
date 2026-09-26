import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { MailIcon, QQIcon, XIcon } from "@/components/social-icons";
import { CONTACT_INFO, EMAIL_URL, QQ_SERVICE_URL } from "@/lib/config";

/**
 * 联系我们（/contact）：四宫格卡片展示全站统一客服渠道。
 * 号码/账号全部来自 src/lib/config.ts CONTACT_INFO（单一事实源）。
 */
export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("contact");

  const cards = [
    {
      key: "qqGroup",
      icon: <QQIcon className="h-7 w-7 text-[#12B7F5]" />,
      title: t("qqGroupTitle"),
      desc: t("qqGroupDesc"),
      actionText: t("qqGroupAction"),
      href: null, // 暂无在线加群链接，展示群号文本引导搜索加入
    },
    {
      key: "qqService",
      icon: <QQIcon className="h-7 w-7 text-[#12B7F5]" />,
      title: t("qqServiceTitle"),
      desc: t("qqServiceDesc"),
      actionText: t("qqServiceAction"),
      href: QQ_SERVICE_URL,
    },
    {
      key: "x",
      icon: <XIcon className="h-7 w-7 text-zinc-900" />,
      title: t("xTitle"),
      desc: t("xDesc"),
      actionText: t("xAction"),
      href: CONTACT_INFO.xUrl,
    },
    {
      key: "email",
      icon: <MailIcon className="h-7 w-7 text-zinc-700" />,
      title: t("emailTitle"),
      desc: t("emailDesc"),
      actionText: t("emailAction"),
      href: EMAIL_URL,
    },
  ];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="text-center">
        <h1 className="text-2xl font-bold text-zinc-900">{t("title")}</h1>
        <p className="mt-2 text-sm text-zinc-500">{t("subtitle")}</p>
      </header>

      {/* 四宫格：QQ群 / 客服QQ / X / 邮箱 */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map((c) => {
          const inner = (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-50">
                {c.icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-zinc-900">{c.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{c.desc}</p>
                <p className="mt-2 break-all text-sm font-medium text-orange-600">
                  {c.actionText}
                  {c.href && <span className="ml-1 text-xs text-zinc-400">↗</span>}
                </p>
              </div>
            </>
          );
          const cls =
            "flex items-start gap-4 rounded-2xl border border-zinc-200 bg-white/90 p-5 shadow-sm transition";
          return c.href ? (
            <a
              key={c.key}
              href={c.href}
              target={c.href.startsWith("http") ? "_blank" : undefined}
              rel={c.href.startsWith("http") ? "noopener noreferrer" : undefined}
              className={`${cls} hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md`}
            >
              {inner}
            </a>
          ) : (
            <div key={c.key} className={cls} title={c.actionText}>
              {inner}
            </div>
          );
        })}
      </div>

      {/* 工作时间 */}
      <p className="mt-6 text-center text-xs text-zinc-400">🕘 {t("workHours")}</p>

      <div className="mt-6 text-center">
        <Link href="/" className="text-sm font-medium text-orange-600 hover:underline">
          {t("backHome")}
        </Link>
      </div>
    </main>
  );
}
