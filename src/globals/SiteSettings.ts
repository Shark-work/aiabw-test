import type { GlobalConfig } from "payload";

import { publicReadAdminWriteGlobal } from "../collections/access.ts";

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
  fields: [
    { name: "siteNameZh", type: "text", defaultValue: "艾比世界", label: "站点名（中）" },
    { name: "siteNameEn", type: "text", defaultValue: "Aibi World", label: "站点名（英）" },
    { name: "sloganZh", type: "textarea", label: "Slogan（中）" },
    { name: "sloganEn", type: "textarea", label: "Slogan（英）" },
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
