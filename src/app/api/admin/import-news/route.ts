import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { adminError, requireAdmin } from "@/lib/admin-guard";
import { dedupeTitles } from "@/lib/news-fetch";

export const runtime = "nodejs";

const MAX_ITEMS = 20;

type ImportItem = {
  title: string;
  desc?: string;
  cover?: string;
  url?: string;
  source?: string;
  timestamp?: number;
};

/**
 * POST /api/admin/import-news  — 后台手动「投喂」国内新闻
 * 入参：JSON 数组 [{ title, desc, cover, url, source, timestamp }]
 * 逻辑：
 *   - 仅 Admin 可调用（requireAdmin：登录 + role=admin + 会话时效）；
 *   - 自动打标 locale='zh'、is_domestic=true；
 *   - 走现有 Jaccard 标题去重（阈值 0.85，按 locale=zh）防重复；
 *   - 幂等写入 hotnews（hot=900 人工投喂优先展示）。
 * 返回：{ ok, inserted, skipped, total }
 */
export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  if (!Array.isArray(body) || body.length === 0 || body.length > MAX_ITEMS) {
    return NextResponse.json(
      { ok: false, error: `需提供 1-${MAX_ITEMS} 条新闻（JSON 数组）` },
      { status: 400 },
    );
  }

  // 字段清洗与校验
  const items: ImportItem[] = [];
  for (const raw of body) {
    if (!raw || typeof raw !== "object") continue;
    const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 300) : "";
    if (!title) continue;
    items.push({
      title,
      desc: typeof raw.desc === "string" ? raw.desc.trim().slice(0, 500) : undefined,
      cover: typeof raw.cover === "string" ? raw.cover.trim().slice(0, 500) : undefined,
      url: typeof raw.url === "string" ? raw.url.trim().slice(0, 500) : undefined,
      source:
        typeof raw.source === "string" && raw.source.trim()
          ? raw.source.trim().slice(0, 100)
          : "运营投稿",
      timestamp: typeof raw.timestamp === "number" && raw.timestamp > 0 ? raw.timestamp : Date.now(),
    });
  }
  if (items.length === 0) {
    return NextResponse.json(
      { ok: false, error: "至少需要一条包含 title 的新闻" },
      { status: 400 },
    );
  }

  try {
    // Jaccard 标题去重（locale=zh）
    const uniqueTitles = new Set(await dedupeTitles(items.map((i) => i.title), "zh"));
    const toInsert = items.filter((i) => uniqueTitles.has(i.title));

    let inserted = 0;
    if (toInsert.length) {
      const values = toInsert.flatMap((i) => [
        i.source,
        i.title,
        i.desc ?? null,
        i.cover ?? null,
        900, // 人工投喂优先展示
        i.timestamp ?? Date.now(),
        i.url ?? null,
        "zh",
        true,
      ]);
      const placeholders = toInsert
        .map((_, k) => `($${k * 9 + 1},$${k * 9 + 2},$${k * 9 + 3},$${k * 9 + 4},$${k * 9 + 5},$${k * 9 + 6},$${k * 9 + 7},$${k * 9 + 8},$${k * 9 + 9})`)
        .join(",");
      const res = await pool.query(
        `INSERT INTO hotnews (source, title, "desc", cover, hot, timestamp, url, locale, is_domestic)
         VALUES ${placeholders}
         ON CONFLICT (locale, source, title) DO NOTHING`,
        values,
      );
      inserted = res.rowCount ?? 0;
    }

    return NextResponse.json({
      ok: true,
      inserted,
      skipped: items.length - inserted,
      total: items.length,
    });
  } catch (err) {
    console.error("[admin/import-news]", err);
    return adminError();
  }
}
