/**
 * 访问计数内存缓存（TTL 60s）：
 *  - 避免每次 /api/visits 都打数据库，缓存读取结果；
 *  - 单实例内存实现（Serverless 多实例时命中率略降但正确性由 DB 原子自增保证）；
 *  - 若后续接入 Redis/Upstash，仅需替换本模块的 get/set 为对应客户端即可。
 */

type CacheEntry = { value: { total: number; unique: number }; expiresAt: number };

const CACHE_TTL_MS = 60_000;
const store = new Map<string, CacheEntry>();

export function visitsCacheGet(key: string): { total: number; unique: number } | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function visitsCacheSet(key: string, value: { total: number; unique: number }): void {
  store.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  // 防内存泄漏：顺手清理过期条目
  if (store.size > 100) {
    const now = Date.now();
    for (const [k, e] of store) {
      if (now > e.expiresAt) store.delete(k);
    }
  }
}

export function visitsCacheClear(): void {
  store.clear();
  dedupe.clear();
}

/** 简化防刷表：IP → 上次计数的 unix 秒（TTL 60s，超量自动清） */
const dedupe = new Map<string, number>();
const DEDUPE_WINDOW_MS = 60_000;

/**
 * 访问计数判定：
 *  - returning（携带 aiabw_visitor Cookie 的老访客）→ 正常刷新计数（页面刷新递增）；
 *  - 新访客/脚本（无 Cookie）→ 同一 IP 60s 内重复请求不计数（防刷）。
 */
export function shouldCountVisit(ip: string, returning: boolean): boolean {
  if (returning) return true;
  const now = Date.now();
  const last = dedupe.get(ip);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return false;
  dedupe.set(ip, now);
  if (dedupe.size > 5000) {
    for (const [k, v] of dedupe) {
      if (now - v > DEDUPE_WINDOW_MS) dedupe.delete(k);
    }
  }
  return true;
}

/** 常见爬虫/Bot UA 关键词：命中则不计数。 */
const BOT_PATTERNS = [
  "bot",
  "crawler",
  "spider",
  "slurp",
  "bingpreview",
  "googlebot",
  "bingbot",
  "duckduckbot",
  "baiduspider",
  "yandex",
  "semrush",
  "ahrefs",
  "mj12bot",
  "petalbot",
  "headlesschrome",
  "python-requests",
  "curl/",
  "wget",
  "facebookexternalhit",
  "twitterbot",
  "telegrambot",
  "whatsapp",
  "bytespider",
  "gptbot",
  "claudebot",
  "perplexitybot",
];

export function isBotUserAgent(ua: string): boolean {
  const lower = ua.toLowerCase();
  return BOT_PATTERNS.some((b) => lower.includes(b));
}
