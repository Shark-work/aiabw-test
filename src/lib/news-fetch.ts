import { pool } from "@/db/client";
import { computeHotScore, isAnimalRelated, isBlockedContent, seedHotNews, SEED_NEWS, type HotNews } from "@/lib/news";

export const runtime = "nodejs";

/** 公开 RSS 数据源（知乎/微博等无公开稳定 API，改采公开 RSS；失败自动回退种子）。 */
const RSS_SOURCES = [
  // ===== 国内（isDomestic: true，中文）=====
  { name: "中新网社会", url: "https://www.chinanews.com.cn/rss/scroll-news.xml", weight: 600, locale: "zh" as const, isDomestic: true },
  { name: "人民网", url: "http://www.people.com.cn/rss/politics.xml", weight: 400, locale: "zh" as const, isDomestic: true },
  { name: "V2EX", url: "https://www.v2ex.com/index.xml", weight: 500, locale: "zh" as const, isDomestic: true },
  { name: "少数派", url: "https://sspai.com/feed", weight: 500, locale: "zh" as const, isDomestic: true },
  // ===== 国外（isDomestic: false，英文）=====
  { name: "The Guardian · Animals", url: "https://www.theguardian.com/world/animals/rss", weight: 900, locale: "en" as const, isDomestic: false },
  { name: "ScienceDaily · Animals", url: "https://www.sciencedaily.com/rss/animals_insects.xml", weight: 600, locale: "en" as const, isDomestic: false },
  { name: "PETA", url: "https://www.peta.org/feed/", weight: 550, locale: "en" as const, isDomestic: false },
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
  isDomestic: boolean;
};

/** 标题归一化（小写 + 去标点/空白，截断 60 字符）。 */
function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 60);
}

/** Jaccard 字符集相似度（0~1）。 */
function jaccardSimilarity(a: string, b: string): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const ch of sa) if (sb.has(ch)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * 标题去重（供自动抓取 + 后台手动投喂共用）：
 * 与库内已有标题（同 locale）+ 本批已接受标题比对，相似度 >0.85 视为重复剔除。
 */
export async function dedupeTitles(titles: string[], locale: string): Promise<string[]> {
  const existing = (
    await pool.query(`SELECT title FROM hotnews WHERE locale = $1`, [locale])
  ).rows.map((r) => String(r.title));
  const accepted: string[] = [];
  const out: string[] = [];
  for (const t of titles) {
    const norm = normalizeTitle(t);
    const dup =
      existing.some((e) => jaccardSimilarity(norm, normalizeTitle(e)) > 0.85) ||
      accepted.some((a) => jaccardSimilarity(norm, normalizeTitle(a)) > 0.85);
    if (!dup) {
      accepted.push(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * 标题相似度去重（防国内源互相搬运/水稿）：
 * 与库内已有标题（同 locale）+ 本批已接受标题比对，相似度 >0.85 视为重复丢弃。
 */
async function dedupeBySimilarity(items: RawItem[], locale: string): Promise<RawItem[]> {
  const existing = (
    await pool.query(`SELECT title FROM hotnews WHERE locale = $1`, [locale])
  ).rows.map((r) => String(r.title));
  const accepted: string[] = [];
  const out: RawItem[] = [];
  for (const it of items) {
    const norm = normalizeTitle(it.title);
    let dup = false;
    for (const t of existing) {
      if (jaccardSimilarity(norm, normalizeTitle(t)) > 0.85) {
        dup = true;
        break;
      }
    }
    if (!dup) {
      for (const t of accepted) {
        if (jaccardSimilarity(norm, normalizeTitle(t)) > 0.85) {
          dup = true;
          break;
        }
      }
    }
    if (!dup) {
      accepted.push(it.title);
      out.push(it);
    }
  }
  return out;
}

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

function parseRss(xml: string, source: string, weight: number): Omit<RawItem, "locale" | "isDomestic">[] {
  const items: Omit<RawItem, "locale" | "isDomestic">[] = [];
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
      collected.push(...parseRss(xml, s.name, s.weight).map((it) => ({ ...it, locale: s.locale, isDomestic: s.isDomestic })));
    } catch {
      // 源不可达：跳过
    }
  }

  // 过滤：仅保留动物相关（真实动物 OR 泛动物文化）+ 屏蔽敏感词
  const filtered = collected.filter((it) => isAnimalRelated(it.title) && !isBlockedContent(it.title, it.desc));

  // 标题相似度去重（按 locale 分别去重，防国内源互相搬运）
  const deduped: RawItem[] = [];
  for (const locale of ["zh", "en"]) {
    deduped.push(...(await dedupeBySimilarity(filtered.filter((it) => it.locale === locale), locale)));
  }

  const rows: { source: string; title: string; desc: string; cover: string | null; hot: number; timestamp: number; url: string; locale: string; isDomestic: boolean }[] = [];

  // 保留热度 Top 20 且按热度分写入
  const scored = deduped
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
      isDomestic: it.isDomestic,
    });
  }

  let fallback = false;
  if (!rows.length) {
    // 全源不可达 / 无动物内容 → 中文种子内容兜底
    fallback = true;
    for (const s of SEED_NEWS) {
      rows.push({ source: s.source, title: s.title, desc: s.desc ?? "", cover: s.cover, hot: computeHotScore(1200, s.timestamp, now), timestamp: s.timestamp, url: s.url ?? "", locale: "zh", isDomestic: true });
    }
  }

  // 幂等写入（locale+source+title 唯一，冲突跳过）
  let inserted = 0;
  if (rows.length) {
    const values = rows.flatMap((r) => [r.source, r.title, r.desc, r.cover, r.hot, r.timestamp, r.url, r.locale, r.isDomestic]);
    const placeholders = rows.map((_, i) => `($${i * 9 + 1},$${i * 9 + 2},$${i * 9 + 3},$${i * 9 + 4},$${i * 9 + 5},$${i * 9 + 6},$${i * 9 + 7},$${i * 9 + 8},$${i * 9 + 9})`).join(",");
    const res = await pool.query(
      `INSERT INTO hotnews (source, title, "desc", cover, hot, timestamp, url, locale, is_domestic)
       VALUES ${placeholders}
       ON CONFLICT (locale, source, title) DO NOTHING`,
      values,
    );
    inserted = res.rowCount ?? 0;
  }

  return { inserted, total: rows.length, fallback };
}

/** 行 → HotNews 映射。 */
function mapNewsRows(rows: Array<Record<string, unknown>>): HotNews[] {
  return rows.map((r) => ({
    id: Number(r.id),
    source: String(r.source),
    title: String(r.title),
    desc: r.desc ? String(r.desc) : null,
    cover: r.cover ? String(r.cover) : null,
    hot: Number(r.hot),
    timestamp: Number(r.timestamp),
    url: r.url ? String(r.url) : null,
    isDomestic: !!r.isDomestic,
  }));
}

/**
 * 按语言查询新闻（80% 国内 + 20% 国外配比，仅 zh 生效）：
 *  - locale='en'：全英文（is_domestic=false）；
 *  - locale='zh'：8 成 locale='zh' 且 is_domestic=true（国内），
 *    2 成 is_domestic=false（国外：优先 zh 翻译行，其次 en 原文），
 *    合并后按 timestamp 混合排序（时间线连贯）；国内不足用中文种子补齐。
 */
export async function queryNewsByLocale(locale: string, limit: number): Promise<HotNews[]> {
  const NEWS_SELECT = `id, source, title, "desc", cover, hot, timestamp, url, is_domestic AS "isDomestic"`;
  if (locale !== "zh") {
    const { rows } = await pool.query(
      `SELECT ${NEWS_SELECT} FROM hotnews WHERE locale = $1 ORDER BY hot DESC LIMIT $2`,
      ["en", limit],
    );
    return mapNewsRows(rows);
  }

  const domN = Math.round(limit * 0.8);
  const intN = Math.max(limit - domN, 0);
  const [dom, intl] = await Promise.all([
    pool.query(
      `SELECT ${NEWS_SELECT} FROM hotnews WHERE locale = 'zh' AND is_domestic = true ORDER BY hot DESC LIMIT $1`,
      [domN],
    ),
    pool.query(
      `SELECT ${NEWS_SELECT} FROM hotnews WHERE is_domestic = false ORDER BY (locale = 'zh') DESC, hot DESC LIMIT $1`,
      [intN],
    ),
  ]);

  let domRows = mapNewsRows(dom.rows);
  // 国内不足 → 中文种子补齐（保证 80% 国内）
  if (domRows.length < domN) {
    const seeds = seedHotNews("zh").slice(domRows.length, domN);
    domRows = [...domRows, ...seeds];
  }

  const all = [...domRows, ...mapNewsRows(intl.rows)].sort((a, b) => b.timestamp - a.timestamp);
  return all.slice(0, limit);
}
