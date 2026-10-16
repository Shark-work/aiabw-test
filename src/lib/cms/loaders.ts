/**
 * CMS 数据加载层（服务端专用；12 个 loader，全部带降级链 + 60s 缓存）。
 *
 * 统一语义（「改表即改站」的安全网）：
 *  - CMS 有数据 → 用 CMS（后台改表，60s 内全站生效；afterChange hook revalidateTag
 *    后下次请求即新——见 src/collections/revalidate.ts，任务六）；
 *  - CMS 空表 / 未配置 Turso / 查询异常 → 回退现有硬编码注册表，前台永不空白；
 *  - 缓存：unstable_cache revalidate=60s + 失效 tag（任务六命名规范），缓存键自动含调用参数；
 *  - 富文本字段返回 Lexical JSON 原样（渲染在 ui-wiring 批次，loader 不做 HTML 转换）。
 */
import { unstable_cache } from "next/cache";

import { AIBI_ITEMS } from "@/lib/aibi-catalog";
import { cmsEnabled, getCms } from "@/lib/cms/payload";
import { MOOD_ACTION_MAP } from "@/lib/pets/sm-contract";
import { resolveSpeciesVisual, SPECIES_VISUALS, type SpeciesVisual } from "@/lib/pets/species-visuals";
import { WORLD_ANCIENTS, WORLD_GLOSSARY, WORLD_LIFE_FORMS, WORLD_REGIONS, WORLD_VALUES } from "@/lib/worldview-data";
import type { HomeHero, Page, PointsEconomy, SiteSetting } from "@/payload-types";

// ─────────────────────── 展示层类型（DB 行与降级数据的统一形状） ───────────────────────
export interface CmsSpecies {
  speciesId: string;
  nameZh?: string | null; nameEn?: string | null;
  personality?: string | null; greetingZh?: string | null; greetingEn?: string | null;
  rivePath?: string | null; staticImage?: string | null; sceneTheme?: string | null;
  sortOrder?: number | null;
}
export interface CmsStory {
  slug: string; kind: string; titleZh: string; titleEn: string;
  summaryZh?: string | null; summaryEn?: string | null;
  contentZh?: unknown; contentEn?: unknown; emoji?: string | null; sortOrder?: number | null;
  /** kind 特有负载（region→type/element/representatives；life-form→subtitle/examples；creed→slogan）。 */
  extra?: Record<string, unknown> | null;
}
export type CmsPage = Pick<Page, "slug" | "titleZh" | "titleEn" | "bodyZh" | "bodyEn" | "seoTitleZh" | "seoTitleEn" | "seoDescZh" | "seoDescEn">;
export interface CmsBanner {
  slug: string; placement: string; titleZh: string; titleEn: string;
  content?: unknown; ctaTextZh?: string | null; ctaTextEn?: string | null;
  ctaUrl?: string | null; imageUrl?: string | null; priority?: number | null;
}
export interface CmsProduct {
  productId: string; kind: string; nameZh: string; nameEn: string;
  descriptionZh?: string | null; descriptionEn?: string | null;
  effectPayload?: unknown; pricePoints: number; priceCny?: number | null;
  rarity?: string | null; sortOrder?: number | null;
}
export interface CmsTokenRule {
  ruleKey: string; points: number; dailyLimit?: number | null;
  cooldownMinutes?: number | null; enabled?: boolean | null;
  /** 展示字段（规则列表用；白名单 Pick——id/内部审计字段绝不下发前台，任务五敏感字段红线）。 */
  nameZh?: string | null; nameEn?: string | null;
  descriptionZh?: string | null; descriptionEn?: string | null;
}

// ─────────────────────── 降级链封装（第一道闸 cmsEnabled，第二道闸 try/catch） ───────────────────────
/**
 * @param tag 缓存失效 tag（任务六命名规范：species/stories/pages/banners/products/token-rules/
 *            pet-animations/site-settings/home-hero/points-economy；缺省 = key）。
 *            后台 afterChange hook revalidateTag(tag) 后，下一次请求即拿新数据（不必等满 60s）。
 */
function withFallback<Args extends unknown[], T>(
  key: string,
  query: (...args: Args) => Promise<T | null>,
  fallback: (...args: Args) => T,
  tag?: string,
): (...args: Args) => Promise<T> {
  const cached = unstable_cache(query, ["cms", key], { revalidate: 60, tags: [tag ?? key] });
  return async (...args: Args) => {
    if (!cmsEnabled()) return fallback(...args);
    try {
      const data = await cached(...args);
      return data ?? fallback(...args);
    } catch (err) {
      console.error(`[cms] loader ${key} 失败，走降级链`, err);
      return fallback(...args);
    }
  };
}

const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
const str = (v: unknown) => (typeof v === "string" ? v : null);


// ─────────────────────── 1) 物种列表 ───────────────────────
export const getSpeciesList = withFallback(
  "species-list",
  async () => {
    const cms = await getCms();
    const res = await cms.find({ collection: "species", limit: 100, sort: "sortOrder", overrideAccess: true });
    if (res.docs.length === 0) return null;
    return res.docs.map((d) => ({
      speciesId: d.speciesId, nameZh: d.nameZh, nameEn: d.nameEn,
      personality: d.personality, greetingZh: d.greetingZh, greetingEn: d.greetingEn,
      rivePath: d.rivePath, staticImage: d.staticImage, sceneTheme: d.sceneTheme,
      sortOrder: d.sortOrder,
    } satisfies CmsSpecies));
  },
  () =>
    Object.entries(SPECIES_VISUALS).map(([speciesId, v]): CmsSpecies => ({
      speciesId, nameZh: speciesId, nameEn: speciesId,
      rivePath: v.rivePath ?? null, staticImage: v.staticImage, sceneTheme: v.sceneTheme, sortOrder: 0,
    })),
  "species",
);

// ─────────────────────── 2) 单物种视觉（舞台渲染用；回退 resolveSpeciesVisual 同形状） ───────────────────────
export const getSpeciesVisualById = withFallback(
  "species-visual",
  async (speciesId: string) => {
    const cms = await getCms();
    const res = await cms.find({
      collection: "species", where: { speciesId: { equals: speciesId } }, limit: 1, overrideAccess: true,
    });
    const d = res.docs[0];
    if (!d) return null;
    const fallbackVisual = resolveSpeciesVisual(speciesId); // 字段级兜底：CMS 缺字段不回退整行
    return {
      rivePath: str(d.rivePath) ?? fallbackVisual.rivePath,
      staticImage: str(d.staticImage) ?? fallbackVisual.staticImage,
      sceneTheme: str(d.sceneTheme) ?? fallbackVisual.sceneTheme,
    } satisfies SpeciesVisual;
  },
  (speciesId: string) => resolveSpeciesVisual(speciesId),
  "species",
);

// ─────────────────────── 3) 情绪→动作映射（全局默认 + 物种覆写合并） ───────────────────────
export const getPetAnimationMap = withFallback(
  "pet-animation-map",
  async (speciesSlug?: string | null) => {
    const cms = await getCms();
    // 数据量小（7 情绪 × N 物种），一次取出内存分组（避免关系点路径查询的适配器差异）
    const res = await cms.find({ collection: "pet-animations", limit: 300, depth: 1, overrideAccess: true });
    if (res.docs.length === 0) return null;
    const map: Record<string, string> = { ...MOOD_ACTION_MAP }; // 代码契约为底，CMS 逐条覆写
    const apply = (rows: typeof res.docs) => {
      for (const r of rows) if (r.mood && r.action) map[r.mood] = r.action;
    };
    apply(res.docs.filter((r) => r.species == null)); // 全局默认
    if (speciesSlug) {
      apply(res.docs.filter((r) => {
        const s = r.species;
        return typeof s === "object" && s !== null && s.speciesId === speciesSlug;
      }));
    }
    return map;
  },
  // fallback 声明同形参数（否则 withFallback 的 Args 推断为 []，带 speciesSlug 调用报类型错）；
  // void 引用消 ESLint unused（参数仅为类型对齐，无运行期用途）
  (_speciesSlug?: string | null) => {
    void _speciesSlug;
    return { ...MOOD_ACTION_MAP } as Record<string, string>;
  },
  "pet-animations",
);

// ─────────────────────── 4) 故事（按类别，仅已发布；世界观六类回退 worldview-data） ───────────────────────
const STORY_FALLBACKS: Record<string, () => CmsStory[]> = {
  region: () => WORLD_REGIONS.map((r) => ({
    slug: `region:${r.id}`, kind: "region", titleZh: r.nameZh, titleEn: r.nameEn,
    summaryZh: r.descriptionZh, summaryEn: r.descriptionEn, emoji: r.emoji, sortOrder: r.sortOrder,
    extra: {
      typeZh: r.typeZh, typeEn: r.typeEn, elementZh: r.elementZh, elementEn: r.elementEn,
      representativesZh: r.representativesZh, representativesEn: r.representativesEn,
    },
  })),
  "life-form": () => WORLD_LIFE_FORMS.map((f) => ({
    slug: `life-form:${f.id}`, kind: "life-form", titleZh: f.nameZh, titleEn: f.nameEn,
    summaryZh: f.descriptionZh, summaryEn: f.descriptionEn, emoji: f.emoji, sortOrder: f.sortOrder,
    extra: { subtitleZh: f.titleZh, subtitleEn: f.titleEn, examplesZh: f.examplesZh, examplesEn: f.examplesEn },
  })),
  creed: () => WORLD_VALUES.map((v) => ({
    slug: `creed:${v.id}`, kind: "creed", titleZh: v.nameZh, titleEn: v.nameEn,
    summaryZh: v.featureZh, summaryEn: v.featureEn, emoji: v.emoji, sortOrder: v.sortOrder,
    extra: { sloganZh: v.sloganZh, sloganEn: v.sloganEn },
  })),
  glossary: () => WORLD_GLOSSARY.map((g) => ({
    slug: `glossary:${g.id}`, kind: "glossary", titleZh: g.termZh, titleEn: g.termEn,
    summaryZh: g.definitionZh, summaryEn: g.definitionEn, emoji: g.emoji, sortOrder: g.sortOrder,
  })),
  "ancient-legend": () => WORLD_ANCIENTS.map((a) => ({
    slug: `ancient:${a.id}`, kind: "ancient-legend", titleZh: a.nameZh, titleEn: a.nameEn,
    summaryZh: a.titleZh, summaryEn: a.titleEn, emoji: a.emoji, sortOrder: 0,
  })),
};

export const getStoriesByKind = withFallback(
  "stories",
  async (kind: string) => {
    const cms = await getCms();
    const res = await cms.find({
      collection: "stories",
      where: { and: [{ kind: { equals: kind } }, { published: { equals: true } }] },
      limit: 100, sort: "sortOrder", overrideAccess: true,
    });
    if (res.docs.length === 0) return null;
    return res.docs.map((d): CmsStory => ({
      slug: d.slug, kind: d.kind, titleZh: d.titleZh, titleEn: d.titleEn,
      summaryZh: d.summaryZh, summaryEn: d.summaryEn,
      contentZh: d.contentZh, contentEn: d.contentEn, emoji: d.emoji, sortOrder: d.sortOrder,
      extra: (d.extra ?? null) as Record<string, unknown> | null,
    }));
  },
  (kind: string) => STORY_FALLBACKS[kind]?.() ?? [],
);


// ─────────────────────── 5) 内容页（仅 published；未命中返回 null 由页面走 404/兜底） ───────────────────────
export const getPageBySlug = withFallback(
  "page",
  async (slug: string) => {
    const cms = await getCms();
    const res = await cms.find({
      collection: "pages",
      where: { and: [{ slug: { equals: slug } }, { status: { equals: "published" } }] },
      limit: 1, overrideAccess: true,
    });
    const d = res.docs[0];
    if (!d) return null;
    return {
      slug: d.slug, titleZh: d.titleZh, titleEn: d.titleEn,
      bodyZh: d.bodyZh, bodyEn: d.bodyEn,
      seoTitleZh: d.seoTitleZh, seoTitleEn: d.seoTitleEn,
      seoDescZh: d.seoDescZh, seoDescEn: d.seoDescEn,
    } satisfies CmsPage;
  },
  () => null as CmsPage | null,
  "pages",
);

// ─────────────────────── 6) 横幅（enabled + 当前时间窗；空表 = 无横幅，不虚构红线） ───────────────────────
export const getBannersByPlacement = withFallback(
  "banners",
  async (placement: string) => {
    const cms = await getCms();
    const res = await cms.find({
      collection: "banners",
      where: { and: [{ placement: { equals: placement } }, { enabled: { equals: true } }] },
      limit: 50, sort: "-priority", depth: 1, overrideAccess: true,
    });
    const now = Date.now();
    const inWindow = res.docs.filter((d) => {
      const start = d.startAt ? Date.parse(d.startAt) : null;
      const end = d.endAt ? Date.parse(d.endAt) : null;
      return (start == null || start <= now) && (end == null || end >= now);
    });
    if (inWindow.length === 0) return null;
    return inWindow.map((d): CmsBanner => {
      const media = d.image;
      return {
        slug: d.slug, placement: d.placement, titleZh: d.titleZh, titleEn: d.titleEn,
        content: d.content, ctaTextZh: d.ctaTextZh, ctaTextEn: d.ctaTextEn, ctaUrl: d.ctaUrl,
        imageUrl:
          (typeof media === "object" && media !== null && str(media.url)) || str(d.imagePath),
        priority: d.priority,
      };
    });
  },
  () => [] as CmsBanner[],
);

// ─────────────────────── 7) 商品目录（仅上架；回退 AIBI_ITEMS 形状映射） ───────────────────────
export const getProductList = withFallback(
  "products",
  async (kind?: string | null) => {
    const cms = await getCms();
    const res = await cms.find({
      collection: "products",
      where: { enabled: { equals: true } },
      limit: 200, sort: "sortOrder", overrideAccess: true,
    });
    const rows = res.docs.filter((d) => !kind || d.kind === kind);
    if (rows.length === 0) return null;
    return rows.map((d): CmsProduct => ({
      productId: d.productId, kind: d.kind, nameZh: d.nameZh, nameEn: d.nameEn,
      descriptionZh: d.descriptionZh, descriptionEn: d.descriptionEn,
      effectPayload: d.effectPayload, pricePoints: num(d.pricePoints),
      priceCny: d.priceCny, rarity: d.rarity, sortOrder: d.sortOrder,
    }));
  },
  (kind?: string | null) =>
    AIBI_ITEMS.filter((i) => !kind || i.itemType === kind).map((i): CmsProduct => ({
      productId: i.id, kind: i.itemType, nameZh: i.nameZh, nameEn: i.nameEn,
      descriptionZh: i.effect, descriptionEn: i.effectEn,
      effectPayload: i.effectPayload, pricePoints: i.pricePoints, priceCny: null,
      rarity: null, sortOrder: 0,
    })),
);

// ─────────────────────── 8) 积分规则（按键取单条；未命中 null → 调用方回退代码默认值） ───────────────────────
export const getTokenRuleByKey = withFallback(
  "token-rule",
  async (ruleKey: string): Promise<CmsTokenRule | null> => {
    const cms = await getCms();
    const res = await cms.find({
      collection: "token-rules",
      where: { and: [{ ruleKey: { equals: ruleKey } }, { enabled: { equals: true } }] },
      limit: 1, overrideAccess: true,
    });
    const d = res.docs[0];
    if (!d) return null;
    return {
      ruleKey: d.ruleKey, points: num(d.points),
      dailyLimit: d.dailyLimit, cooldownMinutes: d.cooldownMinutes, enabled: d.enabled,
    } satisfies CmsTokenRule;
  },
  () => null as CmsTokenRule | null,
  "token-rules",
);

// ─────────────────────── 8b) 积分规则列表（/points 规则区展示；仅 enabled，白名单字段下发） ───────────────────────
export const getTokenRuleList = withFallback(
  "token-rule-list",
  async () => {
    const cms = await getCms();
    const res = await cms.find({
      collection: "token-rules",
      where: { enabled: { equals: true } },
      limit: 100, sort: "ruleKey", overrideAccess: true,
    });
    if (res.docs.length === 0) return null;
    return res.docs.map((d): CmsTokenRule => ({
      ruleKey: d.ruleKey, nameZh: d.nameZh, nameEn: d.nameEn,
      points: num(d.points), dailyLimit: d.dailyLimit, cooldownMinutes: d.cooldownMinutes,
      enabled: d.enabled, descriptionZh: d.descriptionZh, descriptionEn: d.descriptionEn,
    }));
  },
  // 降级 = 空列表：规则展示属信息性内容，CMS 不可用时前台区块整体隐藏（不虚构规则红线）
  () => [] as CmsTokenRule[],
  "token-rules",
);

// ─────────────────────── 9) Globals（各立 cache key + 同名失效 tag；未命中 null → 调用方回退 i18n/代码默认值） ───────────────────────
export const getSiteSettings = withFallback(
  "site-settings",
  async () => {
    const cms = await getCms();
    const doc = await cms.findGlobal({ slug: "site-settings", overrideAccess: true });
    return (doc ?? null) as SiteSetting | null;
  },
  () => null as SiteSetting | null,
);

export const getHomeHero = withFallback(
  "home-hero",
  async () => {
    const cms = await getCms();
    const doc = await cms.findGlobal({ slug: "home-hero", overrideAccess: true });
    return (doc ?? null) as HomeHero | null;
  },
  () => null as HomeHero | null,
);

export const getPointsEconomy = withFallback(
  "points-economy",
  async () => {
    const cms = await getCms();
    const doc = await cms.findGlobal({ slug: "points-economy", overrideAccess: true });
    return (doc ?? null) as PointsEconomy | null;
  },
  () => null as PointsEconomy | null,
);
