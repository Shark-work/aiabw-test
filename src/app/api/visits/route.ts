import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import {
  isBotUserAgent,
  shouldCountVisit,
  visitsCacheGet,
  visitsCacheSet,
} from "@/lib/visits-cache";

export const runtime = "nodejs";

const VISITOR_COOKIE = "aiabw_visitor";
const CACHE_KEY = "site_visits";

/**
 * GET /api/visits
 * 站点累计访问计数：
 *  - 原子递增 visit_count（UPDATE ... RETURNING）；
 *  - 独立访客：首次访问（无 aiabw_visitor Cookie）→ unique_count +1 并下发 Cookie；
 *  - 防刷：同一 IP 60s 内重复请求不计数；爬虫/Bot UA 不计数；
 *  - 缓存：内存 TTL 60s（见 src/lib/visits-cache.ts，避免每请求打库）。
 * 返回：{ ok, total, unique }
 */
export async function GET(req: Request) {
  const ua = req.headers.get("user-agent") ?? "";
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const cookie = req.headers.get("cookie") ?? "";

  const isNewVisitor = !cookie.includes(VISITOR_COOKIE);
  const countThisVisit = !isBotUserAgent(ua) && shouldCountVisit(ip, !isNewVisitor);

  let total: number;
  let unique: number;

  if (countThisVisit) {
    const { rows } = await pool.query(
      `INSERT INTO site_visits (id, visit_count, unique_count)
       VALUES (1, 1, $1)
       ON CONFLICT (id) DO UPDATE
         SET visit_count = site_visits.visit_count + 1,
             unique_count = site_visits.unique_count + $1,
             last_updated = now()
       RETURNING visit_count, unique_count`,
      [isNewVisitor ? 1 : 0],
    );
    total = Number(rows[0]?.visit_count ?? 0);
    unique = Number(rows[0]?.unique_count ?? 0);
    visitsCacheSet(CACHE_KEY, { total, unique });
  } else {
    // 防刷命中 / Bot：不递增，读缓存（60s TTL）；缓存过期则只读不写计数
    const cached = visitsCacheGet(CACHE_KEY);
    if (cached) {
      total = cached.total;
      unique = cached.unique;
    } else {
      const { rows } = await pool.query(
        `SELECT visit_count, unique_count FROM site_visits WHERE id = 1 LIMIT 1`,
      );
      total = Number(rows[0]?.visit_count ?? 0);
      unique = Number(rows[0]?.unique_count ?? 0);
    }
  }

  const res = NextResponse.json({ ok: true, total, unique });
  if (isNewVisitor) {
    const visitorId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    res.cookies.set(VISITOR_COOKIE, visitorId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // 1 年
      httpOnly: true,
      sameSite: "lax",
    });
  }
  return res;
}
