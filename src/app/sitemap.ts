import type { MetadataRoute } from "next";

import { LOCALES, SITE_URL } from "@/lib/site";

/**
 * 全站 XML Sitemap（子目录结构，覆盖所有语言版本）：
 *  - 静态路由 + 动态物种详情页（/pets/<speciesId>，来自 pet_dictionary）；
 *  - 每个公开页面分别输出 /zh/ 与 /en/ 两个 URL；
 *  - 优先权：首页最高，功能页次之，辅助页最低；
 *  - 数据库不可达时降级为纯静态路由（不阻断 sitemap 生成）。
 */
const ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "", priority: 1, changeFrequency: "daily" },
  { path: "/pets", priority: 0.9, changeFrequency: "daily" },
  { path: "/blindbox", priority: 0.8, changeFrequency: "daily" },
  { path: "/news", priority: 0.7, changeFrequency: "daily" },
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 动态物种详情页（SEO 落地页），供百度/谷歌收录每只宠物的独立页面
  let speciesIds: string[] = [];
  try {
    const { pool } = await import("@/db/client");
    const { rows } = await pool.query("SELECT id FROM pet_dictionary ORDER BY id");
    speciesIds = rows.map((r) => String(r.id));
  } catch {
    // DB 不可达：仅输出静态路由
  }

  const staticUrls: MetadataRoute.Sitemap = ROUTES.flatMap((r) =>
    LOCALES.map((locale) => ({
      url: `${SITE_URL}/${locale}${r.path}`,
      lastModified: new Date(),
      changeFrequency: r.changeFrequency,
      priority: r.priority,
    })),
  );

  const speciesUrls: MetadataRoute.Sitemap = speciesIds.flatMap((id) =>
    LOCALES.map((locale) => ({
      url: `${SITE_URL}/${locale}/pets/${id}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  );

  return [...staticUrls, ...speciesUrls];
}

