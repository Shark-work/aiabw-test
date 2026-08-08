import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 项目根目录就是当前目录
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;