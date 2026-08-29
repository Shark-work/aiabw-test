import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { newsCacheGet, newsCacheSet, resolveNewsLocale, seedHotNews, type HotNews } from "@/lib/news";

export const runtime = "nodejs";

const CACHE_KEY = "animalfeed";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

/**
 * GET /api/news/animal-feed?limit=10&locale=zh|en
 * 侧边栏新闻排行榜数据源（**严格语言隔离**）：
 *  - locale：显式参数优先，缺省按 NEXT_LOCALE Cookie，默认 zh；
 *  - SQL 强制 WHERE locale = $1 —— 中文页绝不可能返回英文新闻；
 *  - 查无对应语言数据 → 返回空数组（不降级其他语言）；DB 全空才回退该语言种子；
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

    let news: HotNews[];
    try {
      const { rows } = await pool.query(
        `SELECT id, source, title, "desc", cover, hot, timestamp, url
           FROM hotnews
          WHERE locale = $1 AND status = 'visible'
          ORDER BY hot DESC
          LIMIT $2`,
        [locale, limit],
      );
      news = rows.map((r) => ({
        id: Number(r.id),
        source: r.source,
        title: r.title,
        desc: r.desc,
        cover: r.cover,
        hot: Number(r.hot),
        timestamp: Number(r.timestamp),
        url: r.url,
      }));
    } catch {
      // 表尚未就绪等异常：静默回退该语言种子
      news = [];
    }

    if (!news.length) {
      news = seedHotNews(locale).slice(0, limit);
    }

    newsCacheSet(cacheKey, news);
    return NextResponse.json({ ok: true, news });
  } catch {
    return NextResponse.json({ ok: false, error: "news_feed_failed" }, { status: 500 });
  }
}
