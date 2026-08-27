import type { MetadataRoute } from "next";

import { LOCALES, SITE_URL } from "@/lib/site";

/**
 * 全站 XML Sitemap（SEO 自动化基建）：
 *  - 静态路由（首页/盲盒广场/新闻列表等，zh/en 双版本）；
 *  - 动态宠物详情页 /pets/<speciesId>（slug 模式，来自 pet_dictionary），
 *    附 lastModified（updated_at）+ <image:image> 封面图（来自 pets 表）；
 *  - 动态新闻详情页 /news/<数字id>（来自 hotnews，status='visible'，上限 50），
 *    附 lastModified（updated_at）+ <image:image> cover（为空不附）；
 *  - 排除范围：admin / login / register / chat / api 一律不收录；
 *  - DB 不可达时降级为纯静态路由，不阻断 sitemap 生成。
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
  const { pool } = await import("@/db/client");

  const staticUrls: MetadataRoute.Sitemap = ROUTES.flatMap((r) =>
    LOCALES.map((locale) => ({
      url: `${SITE_URL}/${locale}${r.path}`,
      lastModified: new Date(),
      changeFrequency: r.changeFrequency,
      priority: r.priority,
    })),
  );

  let speciesUrls: MetadataRoute.Sitemap = [];
  let newsUrls: MetadataRoute.Sitemap = [];
  try {
    const [{ rows: species }, { rows: news }] = await Promise.all([
      pool.query(
        `SELECT d.id, d.name_zh AS "nameZh", d.updated_at AS "updatedAt",
                (SELECT p.image_url FROM pets p
                  WHERE p.species_id = d.id AND p.image_url IS NOT NULL LIMIT 1) AS "imageUrl"
           FROM pet_dictionary d ORDER BY d.id`,
      ),
      pool.query(
        `SELECT id, cover, title, updated_at AS "updatedAt"
           FROM hotnews
          WHERE status = 'visible'
          ORDER BY hot DESC
          LIMIT 50`,
      ),
    ]);

    // 宠物详情（slug 模式）：附 lastModified + 封面图 image 标签
    speciesUrls = species.flatMap((s) =>
      LOCALES.map((locale) => ({
        url: `${SITE_URL}/${locale}/pets/${String(s.id)}`,
        lastModified: s.updatedAt ? new Date(String(s.updatedAt)) : new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.7,
        images: s.imageUrl ? [String(s.imageUrl)] : [],
      })),
    );

    // 新闻详情（数字 id）：附 lastModified + cover 图（为空不附）
    newsUrls = news.flatMap((n) =>
      LOCALES.map((locale) => ({
        url: `${SITE_URL}/${locale}/news/${Number(n.id)}`,
        lastModified: n.updatedAt ? new Date(String(n.updatedAt)) : new Date(),
        changeFrequency: "daily" as const,
        priority: 0.6,
        images: n.cover ? [String(n.cover)] : [],
      })),
    );
  } catch {
    // DB 不可达：仅输出静态路由
  }

  return [...staticUrls, ...speciesUrls, ...newsUrls];
}


