import type { GlobalConfig } from "payload";

import { publicReadAdminWriteGlobal } from "../collections/access.ts";
import { revalidateAfterChange } from "../collections/revalidate.ts";

/**
 * 首页主视觉 Global（单例）：Hero 区标题/副标题/三 CTA/背景图/灵魂树彩蛋开关。
 * 对照现有硬编码：messages/*.json 的 home.title / home.subtitle / heroCta /
 * heroCtaExplore / heroCtaShop（Phase 7.1 次级 CTA + Phase 11 世界观叙事）。
 * loader 读不到时回退 i18n 文案（迁移完成前首页永不变样）。
 */
export const HomeHero: GlobalConfig = {
  slug: "home-hero",
  label: "首页主视觉",
  admin: { description: "首页 Hero：标题 / 副标题 / CTA / 背景 / 彩蛋开关。" },
  access: publicReadAdminWriteGlobal,
  hooks: { afterChange: [revalidateAfterChange("home-hero")] },
  fields: [
    { name: "titleZh", type: "text", label: "主标题（中）" },
    { name: "titleEn", type: "text", label: "主标题（英）" },
    { name: "subtitleZh", type: "textarea", label: "副标题（中）" },
    { name: "subtitleEn", type: "textarea", label: "副标题（英）" },
    { name: "ctaPrimaryTextZh", type: "text", label: "主 CTA 文案（中）" },
    { name: "ctaPrimaryTextEn", type: "text", label: "主 CTA 文案（英）" },
    { name: "ctaPrimaryUrl", type: "text", defaultValue: "/adopt", label: "主 CTA 链接" },
    { name: "ctaExploreTextZh", type: "text", label: "探索 CTA 文案（中）" },
    { name: "ctaExploreTextEn", type: "text", label: "探索 CTA 文案（英）" },
    { name: "ctaExploreUrl", type: "text", defaultValue: "/explore-v2", label: "探索 CTA 链接" },
    { name: "ctaShopTextZh", type: "text", label: "商城 CTA 文案（中）" },
    { name: "ctaShopTextEn", type: "text", label: "商城 CTA 文案（英）" },
    { name: "ctaShopUrl", type: "text", defaultValue: "/shop", label: "商城 CTA 链接" },
    { name: "backgroundImage", type: "upload", relationTo: "media", label: "背景图（Media 上传，优先）" },
    { name: "backgroundPath", type: "text", label: "背景图路径（public 兜底）" },
    {
      name: "soulTreeEnabled",
      type: "checkbox",
      defaultValue: true,
      label: "灵魂树彩蛋",
      admin: { description: "关闭后首页隐藏 🌳 彩蛋按钮（Phase 11 灵魂树）。" },
    },
  ],
};
