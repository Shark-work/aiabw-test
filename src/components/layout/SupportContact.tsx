import { getTranslations } from "next-intl/server";

/**
 * 意见反馈与客服联系模块（法律页底部）：QQ 邮箱（mailto）+ QQ 群号。
 */
export async function SupportContact() {
  const ts = await getTranslations("support");
  return (
    <div className="mt-6 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 p-4">
      <p className="text-sm font-semibold text-orange-900">📮 {ts("supportTitle")}</p>
      <p className="mt-1 text-xs leading-relaxed text-orange-700">{ts("supportBody")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-orange-800">
        <span>
          {ts("supportEmail")}：
          <a
            href="mailto:1206309834@qq.com"
            className="font-medium underline decoration-orange-300 underline-offset-2 hover:text-orange-600"
          >
            1206309834@qq.com
          </a>
        </span>
        <span>
          {ts("supportQQGroup")}：
          <span className="font-mono font-medium">1005445619</span>
        </span>
      </div>
    </div>
  );
}
