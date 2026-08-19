/** 判断图片 URL 是否为 Vercel Blob 第一方地址（UGC 头像唯一允许的来源）。 */
export function isBlobUrl(url?: string | null): boolean {
  return typeof url === "string" && /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.blob\.vercel-storage\.com\//i.test(url);
}

/** 判断图片 URL 是否可由 next/image 优化（同源静态资源 或 Blob 白名单域名）。 */
export function isOptimizableImage(url?: string | null): boolean {
  if (typeof url !== "string" || !url) return false;
  if (url.startsWith("/")) return true; // 同源：/resources/... 走 next/image 自动转码
  try {
    return isBlobUrl(url);
  } catch {
    return false;
  }
}
