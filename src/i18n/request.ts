import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";

import { routing } from "./routing";

/** 深度合并：把 src 中缺失的叶子 key 补到 dst（用 src 原文兜底，避免 UI 空白）。 */
function mergeMissing(dst: Record<string, unknown>, src: Record<string, unknown>) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === "object") {
      if (!dst[k] || typeof dst[k] !== "object") dst[k] = {};
      mergeMissing(dst[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else if (dst[k] === undefined) {
      dst[k] = v;
    }
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  const messages = (await import(`../../messages/${locale}.json`)).default as Record<string, unknown>;
  // 兜底：中文缺失的翻译 key 先用英文原文填充，保证任何情况下不渲染空白/undefined
  if (locale === "zh") {
    const en = (await import(`../../messages/en.json`)).default as Record<string, unknown>;
    mergeMissing(messages, en);
  }

  return {
    locale,
    messages,
  };
});
