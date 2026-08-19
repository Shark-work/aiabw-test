import Image from "next/image";

import { isOptimizableImage } from "@/lib/blob-url";

type PetAvatarProps = {
  src?: string | null;
  alt: string;
  className?: string;
  /** 原始图片像素尺寸；next/image 用它计算宽高比（配合 object-cover 裁剪）。 */
  width?: number;
  height?: number;
  priority?: boolean;
};

/**
 * 宠物头像统一组件：
 *  - 同源静态资源（/resources/pet/*.webp）与 Vercel Blob 白名单 → next/image（自动 WebP/AVIF 转码 + 尺寸裁剪）；
 *  - 历史遗留外部 URL（Blob-only 策略前入库的旧数据）→ 降级为普通 <img>，保证页面不崩。
 */
export function PetAvatar({
  src,
  alt,
  className,
  width = 96,
  height = 96,
  priority = false,
}: PetAvatarProps) {
  if (!src) {
    return <span className={`inline-block bg-zinc-100 ${className ?? ""}`} aria-hidden />;
  }
  if (isOptimizableImage(src)) {
    return (
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        loading={priority ? undefined : "lazy"}
        className={className}
      />
    );
  }
  // 旧数据回退：外部图床 URL（Blob-only 前入库）直接用 <img> 渲染，避免 next/image 因域名不在白名单而抛错。
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" width={width} height={height} className={className} />
  );
}
