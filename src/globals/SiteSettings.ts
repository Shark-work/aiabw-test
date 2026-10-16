import type { GlobalConfig } from "payload";

import { publicReadAdminWriteGlobal } from "../collections/access.ts";
import { revalidateAfterChange } from "../collections/revalidate.ts";

/**
 * 站点设置 Global（单例）：站点名 / slogan / 联系渠道 / 备案 / 维护模式。
 * 对照现有硬编码：messages/*.json 的 contact 命名空间（QQ 群 / X / 邮箱 / 工作时间）、
 * src/lib/site.ts（SITE_URL 属构建期 env，不入库）。
 * loader 读不到时回退 i18n 文案，前台永不空白（Commit 4 接线）。
 */
export const SiteSettings: GlobalConfig = {
  slug: "site-settings",
  label: "站点设置",
  admin: { description: "全站单例：品牌 / 联系渠道 / 备案 / 维护模式。" },
  access: publicReadAdminWriteGlobal,
  hooks: { afterChange: [revalidateAfterChange("site-settings")] },
  fields: [
    { name: "siteNameZh", type: "text", defaultValue: "艾比世界", label: "站点名（中）" },
    { name: "siteNameEn", type: "text", defaultValue: "Aibi World", label: "站点名（英）" },
    { name: "sloganZh", type: "textarea", label: "Slogan（中）" },
    { name: "sloganEn", type: "textarea", label: "Slogan（英）" },
    {
      name: "logoUrl",
      type: "text",
      label: "Logo URL",
      admin: { description: "public 路径（如 /icon.svg）或绝对 URL；留空 = 默认 /icon.svg（结构化数据/页眉品牌图）。" },
    },
    {
      name: "faviconUrl",
      type: "text",
      label: "Favicon URL",
      admin: { description: "留空 = 默认 app/icon.svg 约定文件；填了则全站 <link rel=icon> 走此地址。" },
    },
    {
      name: "footerTextZh",
      type: "textarea",
      label: "页脚版权行（中）",
      admin: { description: "替换页脚主版权行；留空 = 回退 i18n footer.copyrightLine。" },
    },
    { name: "footerTextEn", type: "textarea", label: "页脚版权行（英）" },
    { name: "contactEmail", type: "email", label: "联系邮箱" },
    { name: "qqGroup", type: "text", label: "QQ 群号" },
    { name: "xUrl", type: "text", label: "X（Twitter）链接" },
    { name: "icpNumber", type: "text", label: "ICP 备案号（留空 = 页脚不显示）" },
    {
      name: "maintenanceMode",
      type: "checkbox",
      defaultValue: false,
      label: "维护模式",
      admin: { description: "开启后前台展示维护公告（接线后生效；API 不受影响）。" },
    },
    { name: "maintenanceMessageZh", type: "textarea", label: "维护公告（中）" },
    { name: "maintenanceMessageEn", type: "textarea", label: "维护公告（英）" },
  ],
};
