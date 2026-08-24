import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // 支持的语言（前缀式路由，如 /en/... /zh/...）：
  // en 在前 + defaultLocale='en' 使国际用户（Accept-Language 未匹配时）默认英文；
  // 中文用户（Accept-Language: zh-* 或 NEXT_LOCALE=zh）自动落到 /zh。
  locales: ["en", "zh"],
  // 默认语言：英文（与国际化域名 aiabw.com 对齐，localeDetection 按浏览器语言回退）
  defaultLocale: "en",
  // 始终带语言前缀，保证语言与 URL 强绑定、便于 SEO 与持久化
  localePrefix: "always",
  // 启用语言自动检测（Accept-Language + NEXT_LOCALE Cookie 优先）
  localeDetection: true,
});
