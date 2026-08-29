import { pool } from "@/db/client";
import { computeHotScore, isAnimalRelated, isBlockedContent, SEED_NEWS } from "@/lib/news";

export const runtime = "nodejs";

/** 公开 RSS 数据源（知乎/微博等无公开稳定 API，改采公开 RSS；失败自动回退种子）。 */
const RSS_SOURCES = [
  { name: "The Guardian · Animals", url: "https://www.theguardian.com/world/animals/rss", weight: 900, locale: "en" as const },
  { name: "ScienceDaily · Animals", url: "https://www.sciencedaily.com/rss/animals_insects.xml", weight: 600, locale: "en" as const },
  { name: "PETA", url: "https://www.peta.org/feed/", weight: 550, locale: "en" as const },
  { name: "V2EX", url: "https://www.v2ex.com/index.xml", weight: 500, locale: "zh" as const },
  { name: "少数派", url: "https://sspai.com/feed", weight: 500, locale: "zh" as const },
];

type RawItem = {
  source: string;
  title: string;
  desc: string;
  cover: string | null;
  url: string;
  publishedAtMs: number;
  interactions: number;
  locale: string;
};

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<!\[CDATA\[|\]\]>/g, "");
}

function parseRss(xml: string, source: string, weight: number): Omit<RawItem, "locale">[] {
  const items: Omit<RawItem, "locale">[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const body = m[1];
    const title = decodeXml((body.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").trim();
    const link = decodeXml((body.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "").trim();
    const descRaw = decodeXml((body.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const pubDate = (body.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
    const enclosure = (body.match(/<enclosure[^>]*url="([^"]+)"/) || [])[1] || "";
    const cover =
      enclosure || (body.match(/<media:content[^>]*url="([^"]+)"/) || [])[1] || null;
    if (!title || !link) continue;
    items.push({
      source,
      title: title.slice(0, 300),
      desc: descRaw.slice(0, 500),
      cover,
      url: link,
      publishedAtMs: pubDate ? Date.parse(pubDate) || Date.now() : Date.now(),
      // RSS 无互动数：以来源权重为基准互动量（点击/点赞/评论的代理值）
      interactions: weight + Math.floor(Math.random() * 200),
    });
  }
  return items;
}

/** 抓取 + 过滤 + 写入 hotnews（幂等去重），返回本次收录条数。 */
export async function fetchAndStoreNews(): Promise<{ inserted: number; total: number; fallback: boolean }> {
  const now = Date.now();
  const collected: RawItem[] = [];

  for (const s of RSS_SOURCES) {
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "aiabw-news-bot/1.0" } });
      if (!res.ok) continue;
      const xml = await res.text();
      collected.push(...parseRss(xml, s.name, s.weight).map((it) => ({ ...it, locale: s.locale })));
    } catch {
      // 源不可达：跳过
    }
  }

  // 过滤：仅保留动物相关 + 屏蔽敏感词
  const filtered = collected.filter((it) => isAnimalRelated(it.title) && !isBlockedContent(it.title, it.desc));

  const rows: { source: string; title: string; desc: string; cover: string | null; hot: number; timestamp: number; url: string; locale: string }[] = [];

  // 保留热度 Top 20 且按热度分写入
  const scored = filtered
    .map((it) => ({ ...it, hot: computeHotScore(it.interactions, it.publishedAtMs, now) }))
    .sort((a, b) => b.hot - a.hot)
    .slice(0, 20);

  for (const it of scored) {
    rows.push({
      source: it.source,
      title: it.title,
      desc: it.desc,
      cover: it.cover,
      hot: it.hot,
      timestamp: it.publishedAtMs,
      url: it.url,
      locale: it.locale,
    });
  }

  let fallback = false;
  if (!rows.length) {
    // 全源不可达 / 无动物内容 → 中文种子内容兜底
    fallback = true;
    for (const s of SEED_NEWS) {
      rows.push({ source: s.source, title: s.title, desc: s.desc ?? "", cover: s.cover, hot: computeHotScore(1200, s.timestamp, now), timestamp: s.timestamp, url: s.url ?? "", locale: "zh" });
    }
  }

  // 幂等写入（locale+source+title 唯一，冲突跳过）
  let inserted = 0;
  if (rows.length) {
    const values = rows.flatMap((r) => [r.source, r.title, r.desc, r.cover, r.hot, r.timestamp, r.url, r.locale]);
    const placeholders = rows.map((_, i) => `($${i * 8 + 1},$${i * 8 + 2},$${i * 8 + 3},$${i * 8 + 4},$${i * 8 + 5},$${i * 8 + 6},$${i * 8 + 7},$${i * 8 + 8})`).join(",");
    const res = await pool.query(
      `INSERT INTO hotnews (source, title, "desc", cover, hot, timestamp, url, locale)
       VALUES ${placeholders}
       ON CONFLICT (locale, source, title) DO NOTHING`,
      values,
    );
    inserted = res.rowCount ?? 0;
  }

  return { inserted, total: rows.length, fallback };
}
