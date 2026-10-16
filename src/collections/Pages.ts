import type { CollectionConfig } from "payload";

import { publicReadAdminWrite } from "./access.ts";

/**
 * 通用内容页 Collection（后台化目标：关于 / 帮助 / 活动公告等「非业务逻辑页」
 * 的标题 + 正文 + SEO，运营改文案不再走发版）。
 *
 *  - slug 即前台路由段（/[locale]/p/<slug> 或页面内嵌板块，由 Commit 6 ui-wiring 接线）；
 *  - status=draft 时 loader 返回 null，页面走 404 或硬编码兜底；
 *  - 富文本正文为 Lexical JSON，前台经渲染器输出（ui-wiring 批次落地）。
 */
export const Pages: CollectionConfig = {
  slug: "pages",
  labels: { singular: "内容页", plural: "内容页" },
  admin: {
    useAsTitle: "titleZh",
    description: "通用内容页：关于 / 帮助 / 活动公告等运营文案页。",
  },
  access: publicReadAdminWrite,
  fields: [
    {
      name: "slug",
      type: "text",
      required: true,
      unique: true,
      index: true,
      label: "页面标识",
      admin: { description: "如 about / help / event-2026-spring。" },
    },
    { name: "titleZh", type: "text", required: true, label: "标题（中）" },
    { name: "titleEn", type: "text", required: true, label: "标题（英）" },
    { name: "bodyZh", type: "richText", label: "正文（中）" },
    { name: "bodyEn", type: "richText", label: "正文（英）" },
    {
      name: "status",
      type: "select",
      defaultValue: "published",
      label: "状态",
      options: [
        { label: "已发布", value: "published" },
        { label: "草稿", value: "draft" },
      ],
    },
    { name: "seoTitleZh", type: "text", label: "SEO 标题（中）" },
    { name: "seoTitleEn", type: "text", label: "SEO 标题（英）" },
    { name: "seoDescZh", type: "textarea", label: "SEO 描述（中）" },
    { name: "seoDescEn", type: "textarea", label: "SEO 描述（英）" },
  ],
};
