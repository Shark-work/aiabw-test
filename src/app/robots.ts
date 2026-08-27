import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/**
 * robots.txt（爬虫通行证）：
 *  - 允许全部爬虫抓取公开内容；
 *  - 明确 Disallow 后台管理 / API（含支付回调）/ 登录 / 注册 / 聊天等隐私页；
 *  - 末尾声明 Sitemap 引导爬虫第一时间发现站点地图（Next 自动输出为最后一行）。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin/", // 后台管理
          "/api/", // 支付回调 /api/pay/* 等一律屏蔽
          "/zh/login", "/en/login", // 登录（隐私页）
          "/zh/register", "/en/register", // 注册（隐私页）
          "/zh/chat", "/en/chat", // 聊天（需登录态）
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

