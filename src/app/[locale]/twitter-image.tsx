import { OG_ALT, OG_CONTENT_TYPE, OG_SIZE, renderOgShareImage } from "@/lib/og-share-image";

export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** 全站默认 Twitter Card 分享图（与 OG 同源渲染，卡片视觉一致）。 */
export default async function Image() {
  return renderOgShareImage();
}
