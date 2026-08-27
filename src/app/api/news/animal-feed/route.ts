import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { newsCacheGet, newsCacheSet, seedHotNews, type HotNews } from "@/lib/news";

export const runtime = "nodejs";

const CACHE_KEY = "animalfeed";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

/**
 * GET /api/news/animal-feed?limit=10
 * 侧边栏新闻排行榜数据源（与 /api/news/hot 同构，但返回更多条供列表展示）：
 *  - 按热度分降序取 Top N（默认 10，上限 20）；
 *  - 命中内存缓存（TTL 60s）直接返回；
 *  - 数据库无数据（抓取未跑）时回退种子内容；
 *  - 字段：id/source/title/desc/cover/hot/timestamp/url。
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.round(parsed), 1), MAX_LIMIT) : DEFAULT_LIMIT;
    const cacheKey = `${CACHE_KEY}_${limit}`;

    const cached = newsCacheGet(cacheKey);
    if (cached) {
      return NextResponse.json({ ok: true, news: cached });
    }

    let news: HotNews[];
    try {
      const { rows } = await pool.query(
        `SELECT id, source, title, "desc", cover, hot, timestamp, url
           FROM hotnews
          ORDER BY hot DESC
          LIMIT $1`,
        [limit],
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
      // 表尚未就绪等异常：静默回退种子
      news = [];
    }

    if (!news.length) {
      news = seedHotNews().slice(0, limit);
    }

    newsCacheSet(cacheKey, news);
    return NextResponse.json({ ok: true, news });
  } catch {
    return NextResponse.json({ ok: false, error: "news_feed_failed" }, { status: 500 });
  }
}
