import type { NextConfig } from "next";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import createNextIntlPlugin from "next-intl/plugin";

/** 自动版本号： */
function resolveAppVersion(): string {
  try {
    const hash = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (hash) return hash;
  } catch {
    // 没有 .git 时忽略
  }
  try {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      version?: string;
    };
    if (pkg.version) return pkg.version;
  } catch {
    // 忽略
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
};

export default withNextIntl(nextConfig);