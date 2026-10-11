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
  /**
   * 防抄袭（需求 2.1）：生产环境客户端 bundle 代码混淆（javascript-obfuscator
   * 经 webpack-obfuscator 插件），防止浏览器 F12 直接审查源码逻辑与接口结构。
   *  - 仅 !dev && !isServer 生效：开发零干扰、服务端代码不经过（本来就不下发）；
   *  - 保守档位：关 controlFlowFlattening / deadCodeInjection / selfDefending
   *    （避免 chunk 体积爆炸与 Next runtime 兼容性问题），开字符串数组 base64 加密
   *    + 紧凑化——在 Next 生产 minify 基础上进一步提高逆向门槛；
   *  - 插件默认排除 node_modules（含 Rive wasm loader），只混淆自研代码；
   *  - require 失败（依赖缺失）仅告警跳过，绝不阻断整站构建；
   *  - 注意：混淆只是提高门槛，真正的防抄袭根基是「密钥/扣费/状态判断全在服务端」。
   */
  webpack(config, { dev, isServer }) {
    if (!dev && !isServer) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const WebpackObfuscator = require("webpack-obfuscator");
        config.plugins.push(
          new WebpackObfuscator(
            {
              compact: true,
              controlFlowFlattening: false,
              deadCodeInjection: false,
              stringArray: true,
              stringArrayEncoding: ["base64"],
              stringArrayThreshold: 0.5,
              rotateStringArray: true,
              splitStrings: false,
              simplify: true,
              renameGlobals: false,
              selfDefending: false,
              sourceMap: false,
            },
            [],
          ),
        );
      } catch (err) {
        console.warn(
          "[next.config] webpack-obfuscator unavailable, obfuscation skipped:",
          err instanceof Error ? err.message : err,
        );
      }
    }
    return config;
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
