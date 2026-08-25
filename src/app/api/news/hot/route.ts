import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { newsCacheGet, newsCacheSet, seedHotNews, type HotNews } from "@/lib/news";

export const runtime = "nodejs";

const CACHE_KEY = "hotnews_top5";

/**
 * GET /api/news/hot
 * 返回 Top 5 动物新闻头条（热度分排序）：
 *  - 命中内存缓存（TTL 60s）直接返回，避免每次轮播查库；
 *  - 数据库无数据（抓取未跑）时回退种子内容，保证模块有内容；
 *  - 字段：id/source/title/desc/cover/hot/timestamp/url。
 */
export async function GET() {
  const cached = newsCacheGet(CACHE_KEY);
  if (cached) {
    return NextResponse.json({ ok: true, news: cached });
  }

  let news: HotNews[];
  try {
    const { rows } = await pool.query(
      `SELECT id, source, title, "desc", cover, hot, timestamp, url
         FROM hotnews
        ORDER BY hot DESC
        LIMIT 5`,
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
    news = seedHotNews();
  }

  newsCacheSet(CACHE_KEY, news);
  return NextResponse.json({ ok: true, news });
}
