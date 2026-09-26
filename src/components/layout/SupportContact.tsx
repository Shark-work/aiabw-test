import { getTranslations } from "next-intl/server";

import { MailIcon, QQIcon, XIcon } from "@/components/social-icons";
import { CONTACT_INFO, EMAIL_URL, QQ_SERVICE_URL } from "@/lib/config";

/**
 * 意见反馈与客服联系模块（法律页 / FAQ 页底部）：
 * 全站统一四渠道 —— QQ群 + 客服QQ + X (Twitter) + 官方邮箱（CONTACT_INFO 单一事实源）。
 */
export async function SupportContact() {
  const ts = await getTranslations("support");
  return (
    <div className="mt-6 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 p-4">
      <p className="text-sm font-semibold text-orange-900">🎧 {ts("supportTitle")}</p>
      <p className="mt-1 text-xs leading-relaxed text-orange-700">{ts("supportBody")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-orange-800">
        {/* QQ 群：一键加群链接 */}
        <a
          href={CONTACT_INFO.qqGroupJoinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 font-medium underline decoration-orange-300 underline-offset-2 hover:text-orange-600"
          title={ts("socialQqGroupHint")}
        >
          <QQIcon className="h-3.5 w-3.5 text-[#12B7F5]" />
          {ts("socialQqGroup")}
        </a>
        <a
          href={QQ_SERVICE_URL}
          className="flex items-center gap-1 font-medium underline decoration-orange-300 underline-offset-2 hover:text-orange-600"
        >
          <QQIcon className="h-3.5 w-3.5 text-[#12B7F5]" />
          {ts("socialQqService")}
        </a>
        <a
          href={CONTACT_INFO.xUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 font-medium underline decoration-orange-300 underline-offset-2 hover:text-orange-600"
        >
          <XIcon className="h-3.5 w-3.5" />
          {ts("socialX")}
        </a>
        <a
          href={EMAIL_URL}
          className="flex items-center gap-1 font-medium underline decoration-orange-300 underline-offset-2 hover:text-orange-600"
        >
          <MailIcon className="h-3.5 w-3.5" />
          {ts("socialEmail")}
        </a>
      </div>
    </div>
  );
}
