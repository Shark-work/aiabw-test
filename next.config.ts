import type { NextConfig } from "next";
import { execSync } from "child_process";
import { readFileSync } from "fs";

/**
 * 自动版本号：
 * 优先取当前 Git Commit 短哈希（git rev-parse --short HEAD）；
 * 获取失败（如生产构建没有 .git）则回退到 package.json 的 version。
 */
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

const nextConfig: NextConfig = {
  // 项目根目录就是当前目录
  turbopack: {
    root: __dirname,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: resolveAppVersion(),
    // 提升 scrypt 等 CPU 密集异步任务的并发度（libuv 线程池默认 4）。
    // 注意：仅在 Node 进程启动早期生效；Vercel 项目环境变量里也可设置同名项。
    UV_THREADPOOL_SIZE: "8",
  },
};

export default nextConfig;