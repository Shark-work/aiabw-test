import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { pool } from "@/db/client";

type Props = { params: Promise<{ locale: string; id: string }> };

/**
 * /news/[id] —— 重定向页（取消站内中间页）：
 *  - 命中库内新闻的 url → 307 重定向到真实原文（新标签由前端 a[target=_blank] 打开）；
 *  - url 缺失 / 新闻不存在 / 库异常 → 回退重定向到新闻列表 /news。
 */
export default async function NewsRedirectPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  try {
    const { rows } = await pool.query(
      `SELECT url FROM hotnews WHERE id = $1 AND status = 'visible' LIMIT 1`,
      [Number(id)],
    );
    if (rows[0]?.url) redirect(String(rows[0].url));
  } catch {
    // 库异常：回退列表
  }
  redirect(`/${locale}/news`);
}
