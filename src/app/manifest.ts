import type { MetadataRoute } from "next";

/**
 * PWA 应用清单（App Router 元数据约定：自动生成 /manifest.webmanifest 路由，
 * 并向页面 <head> 注入 <link rel="manifest">，配合 public/sw.js 的离线缓存）。
 * 图标由 scripts/generate-pwa-icons.mjs 从 src/app/icon.svg 生成，
 * 品牌色取自 icon.svg 渐变（#fb923c → #f43f5e）。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "艾比世界 · AI 虚拟宠物领养与养成",
    short_name: "艾比世界",
    description:
      "领养专属 AI 虚拟宠物艾比：每天邂逅一只幸运灵宠与灵感签，用 3 合 1 灵力融合培育稀有伙伴。宠物会记住你的每一次互动，陪你慢慢长大。",
    lang: "zh",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#fb923c",
    categories: ["entertainment", "games", "lifestyle"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
