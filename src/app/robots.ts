import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/** robots.txt：允许全部爬虫，并声明 XML Sitemap 供搜索引擎发现。 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
