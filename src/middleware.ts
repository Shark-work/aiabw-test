import createMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";

import { routing } from "./i18n/routing";
import { stripLocalePrefix } from "./lib/site";

const intlMiddleware = createMiddleware(routing);

/**
 * 国际化中间件：
 *  - / 与未带前缀的路径 → 重定向到默认语言 /zh；
 *  - /zh、/en 正常放行，并按 NEXT_LOCALE Cookie 保持用户选择的语言；
 *  - 注入 `x-pathname`（无语言前缀的路径）请求头，供 [locale]/layout 的
 *    generateMetadata 生成 per-page canonical + hreflang（zh/en/x-default）；
 *  - 排除 /api、_next、静态资源与带扩展名的路径。
 */
export default function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", stripLocalePrefix(request.nextUrl.pathname));
  return intlMiddleware(new NextRequest(request, { headers: requestHeaders }));
}

export const config = {
  // 排除 api/_next/_vercel/带扩展名路径；admin 后台路由不参与 locale 前缀化
  matcher: ["/((?!api|_next|_vercel|admin|.*\\..*).*)"],
};

