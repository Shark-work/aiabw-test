import type { MetadataRoute } from "next";

import { LOCALES, SITE_URL } from "@/lib/site";

/**
 * 全站 XML Sitemap（子目录结构，覆盖所有语言版本）：
 *  - 每个公开页面分别输出 /zh/ 与 /en/ 两个 URL；
 *  - 优先权：首页最高，功能页次之，辅助页最低。
 */
const ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "", priority: 1, changeFrequency: "daily" },
  { path: "/pets", priority: 0.9, changeFrequency: "daily" },
  { path: "/my-pets", priority: 0.7, changeFrequency: "daily" },
  { path: "/marketplace", priority: 0.6, changeFrequency: "weekly" },
  { path: "/handbooks", priority: 0.5, changeFrequency: "weekly" },
  { path: "/points", priority: 0.6, changeFrequency: "weekly" },
  { path: "/about", priority: 0.3, changeFrequency: "monthly" },
  { path: "/faq", priority: 0.4, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.3, changeFrequency: "monthly" },
  { path: "/legal/terms", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/privacy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/virtual-goods", priority: 0.2, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.flatMap((r) =>
    LOCALES.map((locale) => ({
      url: `${SITE_URL}/${locale}${r.path}`,
      lastModified: new Date(),
      changeFrequency: r.changeFrequency,
      priority: r.priority,
    })),
  );
}
