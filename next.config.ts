import type { NextConfig } from "next";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import createNextIntlPlugin from "next-intl/plugin";

/** 自动版本号：优先使用 package.json 的语义化版本（v1.2.0），git hash 兑底。 */
function resolveAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      version?: string;
    };
    if (pkg.version && /^\d+\.\d+\.\d+/.test(pkg.version)) return pkg.version;
  } catch {
    // 忽略
  }
  try {
    const hash = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (hash) return hash;
  } catch {
    // 没有 .git 时忽略
  }
  return "dev";
}

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // 项目根目录就是当前目录
  turbopack: {
    root: __dirname,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: resolveAppVersion(),
    // 提升 scrypt 等 CPU 密集异步任务的并发度（libuv 线程池默认 4）。
    UV_THREADPOOL_SIZE: "8",
  },
  // 图片优化：宠物头像统一走 next/image → Vercel 端按需转码 WebP/AVIF 并缓存一年。
  // remotePatterns 只放行 Vercel Blob（UGC 头像 Blob-only 第一方存储），外部图床一律拒绝。
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 31536000,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.blob.vercel-storage.com",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
