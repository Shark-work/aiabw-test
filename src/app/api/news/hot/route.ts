import { NextResponse } from "next/server";

import { newsCacheGet, newsCacheSet, resolveNewsLocale } from "@/lib/news";
import { queryNewsByLocale } from "@/lib/news-fetch";

export const runtime = "nodejs";

const CACHE_KEY = "hotnews_top5";

/**
 * GET /api/news/hot?locale=zh|en
 * 返回 Top 5 动物新闻头条（热度分排序）：
 *  - locale：显式参数优先，缺省按 NEXT_LOCALE Cookie，默认 zh；
 *  - zh：80% 国内 + 20% 国外混合（queryNewsByLocale），时间线按 timestamp 连贯；
 *  - en：全英文；
 *  - 缓存 key 含 locale（zh/en 互不串缓存）。
 */
export async function GET(req: Request) {
  const locale = resolveNewsLocale(req);
  const cacheKey = `${CACHE_KEY}_${locale}`;

  const cached = newsCacheGet(cacheKey);
  if (cached) {
    return NextResponse.json({ ok: true, news: cached });
  }

  const news = await queryNewsByLocale(locale, 5);

  newsCacheSet(cacheKey, news);
  return NextResponse.json({ ok: true, news });
}
