import type { CollectionConfig } from "payload";

import { publicReadAdminWrite } from "./access.ts";
import { revalidateAfterChange } from "./revalidate.ts";

/**
 * 故事 Collection（后台化目标：worldview-data.ts 的世界观文本——创世神话 / 8 区域 /
 * 3 生命形态 / 5 信条 / 6 概念词条 / 古灵传说——以及后续灵魂卡故事，统一进库）。
 *
 *  - kind 六类对应世界观文档板块；card-story 预留给灵魂卡故事（soul-card-story）；
 *  - 双语字段平行存储（与全站 i18n 模式一致，loader 按 locale 取一侧）；
 *  - published=false 的行 loader 一律不可见（草稿态）；
 *  - 空表时 /world 等页面回退 worldview-data.ts 硬编码（迁移完成前永不空白）。
 */
export const Stories: CollectionConfig = {
  slug: "stories",
  labels: { singular: "故事", plural: "故事" },
  admin: {
    useAsTitle: "titleZh",
    description: "世界观 / 区域志 / 信条 / 词条 / 古灵传说 / 灵魂卡故事。",
  },
  defaultSort: "sortOrder",
  access: publicReadAdminWrite,
  hooks: { afterChange: [revalidateAfterChange("stories")] },
  fields: [
    {
      name: "slug",
      type: "text",
      required: true,
      unique: true,
      index: true,
      label: "标识",
      admin: { description: "如 creation / region:town / creed:resonance / glossary:soul-seed。" },
    },
    {
      name: "kind",
      type: "select",
      required: true,
      index: true,
      label: "类别",
      options: [
        { label: "创世神话", value: "creation-myth" },
        { label: "区域志", value: "region" },
        { label: "生命形态", value: "life-form" },
        { label: "信条", value: "creed" },
        { label: "概念词条", value: "glossary" },
        { label: "古灵传说", value: "ancient-legend" },
        { label: "灵魂卡故事", value: "card-story" },
      ],
    },
    { name: "titleZh", type: "text", required: true, label: "标题（中）" },
    { name: "titleEn", type: "text", required: true, label: "标题（英）" },
    { name: "summaryZh", type: "textarea", label: "摘要（中）" },
    { name: "summaryEn", type: "textarea", label: "摘要（英）" },
    { name: "contentZh", type: "richText", label: "正文（中）" },
    { name: "contentEn", type: "richText", label: "正文（英）" },
    {
      name: "extra",
      type: "json",
      label: "类别特有负载（JSON）",
      admin: {
        description:
          "kind 特有字段：region→{typeZh/En,elementZh/En,representativesZh/En}；life-form→{subtitleZh/En,examplesZh/En}；creed→{sloganZh/En}。",
      },
    },
    { name: "emoji", type: "text", label: "图标 Emoji" },
    { name: "sortOrder", type: "number", defaultValue: 0, label: "排序" },
    {
      name: "published",
      type: "checkbox",
      defaultValue: true,
      label: "已发布",
      admin: { description: "取消勾选 = 草稿，前台 loader 不可见。" },
    },
  ],
};
