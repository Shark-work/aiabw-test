import { getTranslations } from "next-intl/server";

import { TelegramIcon, XIcon } from "@/components/social-icons";
import { SOCIAL } from "@/lib/config";

/**
 * 意见反馈与客服联系模块（法律页底部）：X (Twitter) + Telegram 官方入口。
 */
export async function SupportContact() {
  const ts = await getTranslations("support");
  return (
    <div className="mt-6 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 p-4">
      <p className="text-sm font-semibold text-orange-900">🎧 {ts("supportTitle")}</p>
      <p className="mt-1 text-xs leading-relaxed text-orange-700">{ts("supportBody")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-orange-800">
        <a
          href={SOCIAL.x}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 font-medium underline decoration-orange-300 underline-offset-2 hover:text-orange-600"
        >
          <XIcon className="h-3.5 w-3.5" />
          {ts("socialX")}
        </a>
        <a
          href={SOCIAL.telegram}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 font-medium underline decoration-orange-300 underline-offset-2 hover:text-orange-600"
        >
          <TelegramIcon className="h-3.5 w-3.5" />
          {ts("socialTelegram")}
        </a>
      </div>
    </div>
  );
}
