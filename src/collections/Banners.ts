import type { CollectionConfig } from "payload";

import { publicReadAdminWrite } from "./access.ts";
import { revalidateAfterChange } from "./revalidate.ts";

/**
 * 横幅 Collection（后台化目标：首页 Hero 下横幅 / 商城限时特惠横幅 / 探索页公告条
 * 等运营位；Phase 7.6 的「不虚构折扣」红线延续——无真实活动时保持空表即无横幅）。
 *
 *  - placement 决定渲染位置（ui-wiring 批次接线，未知位置前台忽略）；
 *  - 时间窗：startAt/endAt 任一空 = 该侧不限；loader 仅取当前时间窗内 enabled 的；
 *  - image（Media 上传）优先，imagePath（public 既有素材）兜底——迁移期两手准备；
 *  - priority 大的优先展示（同位置多条时）。
 */
export const Banners: CollectionConfig = {
  slug: "banners",
  labels: { singular: "横幅", plural: "横幅" },
  admin: {
    useAsTitle: "titleZh",
    description: "运营横幅：位置 + 时间窗 + CTA；无真实活动不虚构（红线）。",
  },
  defaultSort: "-priority",
  access: publicReadAdminWrite,
  hooks: { afterChange: [revalidateAfterChange("banners")] },
  fields: [
    { name: "slug", type: "text", required: true, unique: true, label: "标识" },
    {
      name: "placement",
      type: "select",
      required: true,
      index: true,
      label: "投放位置",
      options: [
        { label: "首页主横幅", value: "home-hero" },
        { label: "商城顶部", value: "shop-top" },
        { label: "探索页顶部", value: "explore-top" },
        { label: "宠物互动页", value: "pet-play" },
        { label: "全站顶条", value: "global-topbar" },
      ],
    },
    { name: "titleZh", type: "text", required: true, label: "标题（中）" },
    { name: "titleEn", type: "text", required: true, label: "标题（英）" },
    { name: "content", type: "richText", label: "富文本内容（任务书规格）" },
    { name: "ctaTextZh", type: "text", label: "按钮文案（中）" },
    { name: "ctaTextEn", type: "text", label: "按钮文案（英）" },
    { name: "ctaUrl", type: "text", label: "按钮链接" },
    { name: "image", type: "upload", relationTo: "media", label: "配图（Media 上传，优先）" },
    { name: "imagePath", type: "text", label: "配图路径（public 兜底）" },
    { name: "startAt", type: "date", label: "开始时间（空 = 立即）" },
    { name: "endAt", type: "date", label: "结束时间（空 = 不限）" },
    { name: "priority", type: "number", defaultValue: 0, label: "优先级（大者优先）" },
    { name: "enabled", type: "checkbox", defaultValue: true, label: "启用" },
  ],
};
