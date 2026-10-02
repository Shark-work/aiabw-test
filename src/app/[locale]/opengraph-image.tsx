import { OG_ALT, OG_CONTENT_TYPE, OG_SIZE, renderOgShareImage } from "@/lib/og-share-image";

export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** 全站默认 OpenGraph 分享图（[locale] 段约定文件，全站页面自动继承 og:image）。 */
export default async function Image() {
  return renderOgShareImage();
}
