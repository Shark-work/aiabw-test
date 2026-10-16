import { getHomeHero } from "@/lib/cms/loaders";
import { HomeClient, type HomeHeroView } from "@/components/home/home-client";

/**
 * 首页（RSC 壳，任务二 HomeHero 读取侧接线）：
 *  - Hero 区块标题/副标题/三 CTA/背景图/灵魂树开关走 CMS HomeHero Global
 *    （unstable_cache 60s + afterChange revalidateTag("home-hero") 即新）；
 *  - upload 字段在服务端提取为纯 URL（富文本/媒体对象不进客户端 bundle）；
 *    backgroundImage 上传优先，backgroundPath（public 路径）兜底；
 *  - CMS 空表 / 未配置 Turso / 字段留空 → hero=null 或字段级空值，
 *    home-client 内回退 i18n home.* 硬编码——首页渲染与接入前完全一致（降级链红线）。
 */
export default async function HomePage() {
  const hero = await getHomeHero();
  const bgMedia = hero?.backgroundImage;
  const backgroundUrl =
    (typeof bgMedia === "object" && bgMedia !== null && typeof bgMedia.url === "string"
      ? bgMedia.url
      : null) ||
    hero?.backgroundPath?.trim() ||
    null;
  const view: HomeHeroView | null = hero
    ? {
        titleZh: hero.titleZh, titleEn: hero.titleEn,
        subtitleZh: hero.subtitleZh, subtitleEn: hero.subtitleEn,
        ctaPrimaryTextZh: hero.ctaPrimaryTextZh, ctaPrimaryTextEn: hero.ctaPrimaryTextEn,
        ctaPrimaryUrl: hero.ctaPrimaryUrl,
        ctaExploreTextZh: hero.ctaExploreTextZh, ctaExploreTextEn: hero.ctaExploreTextEn,
        ctaExploreUrl: hero.ctaExploreUrl,
        ctaShopTextZh: hero.ctaShopTextZh, ctaShopTextEn: hero.ctaShopTextEn,
        ctaShopUrl: hero.ctaShopUrl,
        backgroundUrl,
        soulTreeEnabled: hero.soulTreeEnabled,
      }
    : null;
  return <HomeClient hero={view} />;
}
