import zh from "../../messages/zh.json";
import en from "../../messages/en.json";

import { aibiNameEligible, aibiNameFor } from "@/lib/aibi-names";
import { isSpeciesPetType, speciesIdOf } from "@/lib/species-prompt";

export type Locale = "zh" | "en";

/**
 * 解析用户语言：?locale= 显式参数优先，缺省按 Cookie（next-intl 中间件写入的
 * NEXT_LOCALE），默认中文。供服务端 API 路由返回对应语言的错误文案/数据。
 * query 优先的原因：CDN 缓存键含 query 但不含 Cookie —— 带 s-maxage 的接口
 * （如 /api/pets/daily）客户端显式传 ?locale= 后 zh/en 缓存天然分片，
 * 避免跨语言串味（模式与 src/lib/news.ts resolveNewsLocale 一致）。
 */
export function resolveLocale(req: Request): Locale {
  try {
    const q = new URL(req.url).searchParams.get("locale");
    if (q === "en" || q === "zh") return q;
  } catch {
    // req.url 无法解析时静默回退 Cookie 判定
  }
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)NEXT_LOCALE=(zh|en)/);
  return m && (m[1] === "en" || m[1] === "zh") ? m[1] : "zh";
}

/** 读取 messages/<locale>.json 中 api 命名空间下的文案，支持 {param} 插值。 */
export function apiMessage(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const dict = (locale === "en" ? en : zh) as {
    api?: Record<string, string>;
  };
  const msg = dict?.api?.[key] ?? key;
  if (!params) return msg;
  return msg.replace(/\{(\w+)\}/g, (_, k: string) =>
    params[k] !== undefined ? String(params[k]) : `{${k}}`,
  );
}

/** 快捷函数：apiError(locale, "signInFirst", { name }) → 本地化错误文案。 */
export function apiError(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  return apiMessage(locale, key, params);
}

/**
 * 老数据宠物名映射（数据层）：
 * 官方宠物（fox/penguin/dog）按当前 locale 返回对应语言的名字（抱抱狐 / Huggy Fox），
 * 图鉴物种（species:<id>）在史诗及以上稀有度实例（rarity 参数）且物种有映射时
 * 派生艾比名（单源 src/lib/aibi-names.ts），
 * UGC、未达稀有度门槛或未知宠物回退到数据库存储名。不修改数据库原始数据。
 */
export function petDisplayName(
  locale: Locale,
  petType: string,
  fallback: string,
  rarity?: string | null,
): string {
  if (isSpeciesPetType(petType)) {
    // 稀有度门槛内聚：未传 rarity（无实例归属信息）时保守回退原型名快照
    const aibi = aibiNameEligible(rarity)
      ? aibiNameFor(speciesIdOf(petType), locale)
      : null;
    return aibi ?? fallback;
  }
  const pets = (locale === "en" ? en : zh) as {
    pets?: Record<string, { name?: string }>;
  };
  const localized = pets?.pets?.[petType]?.name;
  return localized || fallback;
}
