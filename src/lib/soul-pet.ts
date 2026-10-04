// 灵宠体系 · 灵魂名派生单源（2026-10-09「我的灵宠」产品升级）。
// 设计模式参照 aibi-names.ts：DB 只存原型名/traits，灵魂名在读路径派生，零迁移。
// 灵魂名 = 元素前缀 + 基础名（艾比名优先，回退原型名）：
//   zh「水之灵·泡泡」 / en「Water Spirit · Bubbles」。
// 元素取实例 traits.element（图鉴卡 = 物种 rep 实例；详情页 = 最高稀有度版本）。

/** 元素 → 双语灵魂前缀。 */
export const SOUL_ELEMENT_PREFIX = {
  water: { zh: "水之灵", en: "Water Spirit" },
  fire: { zh: "火之灵", en: "Fire Spirit" },
  earth: { zh: "地之灵", en: "Earth Spirit" },
  air: { zh: "风之灵", en: "Wind Spirit" },
} as const;

export type SoulElement = keyof typeof SOUL_ELEMENT_PREFIX;

/** 元素缺失/未知时的兜底前缀（保守派生，不返回空名）。 */
export const SOUL_FALLBACK_PREFIX = { zh: "魂之灵", en: "Soul Spirit" } as const;

/**
 * 灵魂名派生：元素前缀 + 基础名。
 * @param element  traits.element（fire/water/earth/air；未知值走兜底前缀）
 * @param baseName 基础名（调用方传入 aibiName ?? speciesName，已按 locale 本地化）
 * @param locale   zh / en
 */
export function soulNameFor(
  element: string | null | undefined,
  baseName: string,
  locale: string,
): string {
  const entry = element
    ? (SOUL_ELEMENT_PREFIX as Record<string, { zh: string; en: string }>)[element]
    : undefined;
  const prefix = entry ?? SOUL_FALLBACK_PREFIX;
  const head = locale === "en" ? prefix.en : prefix.zh;
  // zh 紧凑排版「水之灵·泡泡」；en 词间留空「Water Spirit · Bubbles」
  return locale === "en" ? `${head} · ${baseName}` : `${head}·${baseName}`;
}
