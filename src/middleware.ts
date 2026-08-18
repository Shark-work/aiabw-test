import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

/**
 * 国际化中间件：
 *  - / 与未带前缀的路径 → 重定向到默认语言 /zh；
 *  - /zh、/en 正常放行，并按 NEXT_LOCALE Cookie 保持用户选择的语言；
 *  - 排除 /api、_next、静态资源与带扩展名的路径。
 */
export default createMiddleware(routing);

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
