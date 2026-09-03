import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

// 旧版线程直达页：没有领养上下文，历史上固定渲染默认「抱抱狐」，
// 是「进了对话却显示狐狸」的残留入口（旧书签 / 搜索引擎收录的链接）。
// 现统一重定向到 /chat?thread=<id>：聊天页会按线程反查领养记录
// （adoptions.thread_id 兜底，见 chat/page.tsx），展示该线程的真实宠物。
export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  setRequestLocale(locale);
  redirect(`/${locale}/chat?thread=${id}`);
}
