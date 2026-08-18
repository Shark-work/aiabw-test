import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // 支持的语言（前缀式路由，如 /zh/... /en/...）
  locales: ["zh", "en"],
  // 默认语言：中文
  defaultLocale: "zh",
  // 始终带语言前缀，保证语言与 URL 强绑定、便于 SEO 与持久化
  localePrefix: "always",
});
