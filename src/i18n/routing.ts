import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // 支持的语言（前缀式路由，如 /zh/... /en/...）：
  // zh 在前 + defaultLocale='zh' 使未匹配用户（Accept-Language 非英文）默认中文；
  // 英文用户（Accept-Language: en-* 或 NEXT_LOCALE=en）自动落到 /en，/en 路径始终可访问。
  locales: ["zh", "en"],
  // 默认语言：中文（主站定位中文优先；x-default hreflang 本就指向 /zh，与此一致；
  // localeDetection 仍按浏览器语言优先回退，英文访客不受影响）
  defaultLocale: "zh",
  // 始终带语言前缀，保证语言与 URL 强绑定、便于 SEO 与持久化
  localePrefix: "always",
  // 启用语言自动检测（Accept-Language + NEXT_LOCALE Cookie 优先）
  localeDetection: true,
});
