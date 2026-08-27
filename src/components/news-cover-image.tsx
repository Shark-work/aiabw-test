"use client";

const FALLBACK_COVER = "/resources/pet/fox2.webp";

/**
 * 新闻封面图（客户端）：外链 cover 防盗链/失效时自动回退站内占位图。
 *  - 服务端页面无法绑定 onError，故独立为 client 组件供新闻详情页复用。
 */
export function NewsCoverImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    // 远程新闻域名不可控（next/image 需逐一配置 remotePatterns 且不支持 onError 回退），保留原生 img。
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={className}
      onError={(e) => {
        const el = e.currentTarget;
        if (el.src !== window.location.origin + FALLBACK_COVER) el.src = FALLBACK_COVER;
      }}
    />
  );
}
