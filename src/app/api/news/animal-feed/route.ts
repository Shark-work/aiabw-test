import { NextResponse } from "next/server";

import { newsCacheGet, newsCacheSet, resolveNewsLocale } from "@/lib/news";
import { queryNewsByLocale } from "@/lib/news-fetch";

export const runtime = "nodejs";

const CACHE_KEY = "animalfeed";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

/**
 * GET /api/news/animal-feed?limit=10&locale=zh|en
 * 侧边栏新闻排行榜（80% 国内 + 20% 国外配比，仅 zh 生效）：
 *  - locale：显式参数优先，缺省按 NEXT_LOCALE Cookie，默认 zh；
 *  - zh：国内 8 + 国外 2（queryNewsByLocale），按 timestamp 混合排序；
 *  - en：全英文；
 *  - 缓存 key 含 locale + limit。
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const locale = resolveNewsLocale(req);
    const parsed = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.round(parsed), 1), MAX_LIMIT) : DEFAULT_LIMIT;
    const cacheKey = `${CACHE_KEY}_${locale}_${limit}`;

    const cached = newsCacheGet(cacheKey);
    if (cached) {
      return NextResponse.json({ ok: true, news: cached });
    }

    const news = await queryNewsByLocale(locale, limit);

    newsCacheSet(cacheKey, news);
    return NextResponse.json({ ok: true, news });
  } catch {
    return NextResponse.json({ ok: false, error: "news_feed_failed" }, { status: 500 });
  }
}
