import zh from "../../messages/zh.json";
import en from "../../messages/en.json";

export type Locale = "zh" | "en";

/**
 * 从请求 Cookie 中解析用户语言（next-intl 中间件写入的 NEXT_LOCALE），
 * 供服务端 API 路由返回对应语言的错误文案；默认中文。
 */
export function resolveLocale(req: Request): Locale {
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)NEXT_LOCALE=(zh|en)/);
  return m && (m[1] === "en" || m[1] === "zh") ? m[1] : "zh";
}

/** 读取 messages/<locale>.json 中 api 命名空间下的文案，支持 {param} 插值。 */
export function apiMessage(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const dict = (locale === "en" ? en : zh) as {
    api?: Record<string, string>;
  };
  const msg = dict?.api?.[key] ?? key;
  if (!params) return msg;
  return msg.replace(/\{(\w+)\}/g, (_, k: string) =>
    params[k] !== undefined ? String(params[k]) : `{${k}}`,
  );
}

/** 快捷函数：apiError(locale, "signInFirst", { name }) → 本地化错误文案。 */
export function apiError(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  return apiMessage(locale, key, params);
}
